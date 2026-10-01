import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  net,
  screen,
  session,
  shell,
  Tray,
} from "electron";

import { parseInstanceUrl } from "../shared/instance-url";
import {
  type ConnectResult,
  type CurrentInstance,
  channels,
  connectInputSchema,
  type MenuCommand,
  menuCommandSchema,
  platformOf,
} from "../shared/ipc";
import { parseDesktopBuild } from "./build-info";
import { parseDesktopEnv } from "./env";
import { i18nForSystem } from "./i18n";
import { checkInstance } from "./instance";
import { menuTemplate, trayMenuTemplate } from "./menu";
import { createQuickAi } from "./quick-ai";
import {
  applyQuickShortcut,
  parseQuickShortcut,
  type QuickShortcut,
  type QuickShortcutSetting,
  registrationMessage,
} from "./quick-shortcut";
import {
  guardContents,
  guardEveryContents,
  guardSession,
  markUserAgent,
} from "./security";
import {
  readSettings,
  type Settings,
  settingsPath,
  writeSettings,
} from "./settings";
import { drawTrayIcon } from "./tray-icon";
import { startAutoUpdate } from "./updates";
import { placeWindow, windowStateOf } from "./window-state";

// The desktop shell (ticket 116). Instance URL only (122): the main window
// shows the instance's own web app, signed in with its own cookies in a
// persistent partition. The one local page is the first-run screen that asks
// which instance to use. Quick AI (118) is a second, floating window on the
// instance's `/quick` page, opened by a global shortcut, the menus or the
// menu bar icon. Electron's wiring lives here; the rules it applies are pure
// functions in src/shared and src/main.

/** Written in by electron.vite.config.ts from the brand (ticket 119). */
declare const __DESKTOP_BUILD__: unknown;

const build = parseDesktopBuild(
  typeof __DESKTOP_BUILD__ === "undefined" ? undefined : __DESKTOP_BUILD__
);
const env = parseDesktopEnv(process.env);
const platform = platformOf(process.platform);
const INSTANCE_PARTITION = "persist:instance";
const MAIN_WINDOW = {
  defaults: { height: 860, width: 1280 },
  minimum: { height: 480, width: 720 },
} as const;
/** How long the window rests after a move or resize before its bounds are saved. */
const SAVE_BOUNDS_MS = 500;

const preload = (name: "instance" | "setup") =>
  fileURLToPath(new URL(`../preload/${name}.cjs`, import.meta.url));

/** The hardened defaults every window gets (D24). */
const webPreferences = (
  name: "instance" | "setup",
  partition?: string
): Electron.WebPreferences => ({
  contextIsolation: true,
  navigateOnDragDrop: false,
  nodeIntegration: false,
  partition,
  preload: preload(name),
  safeDialogs: true,
  sandbox: true,
  webviewTag: false,
});

/**
 * The brand's template image (scripts/brand-assets.ts), or the built-in
 * bubble when there isn't one. It's in Resources/brand once packaged, and in
 * .brand/ beside the app in a dev run (the build writes it).
 */
const trayImage = (): Electron.NativeImage => {
  // Loads the @2x file beside it too.
  const branded = nativeImage.createFromPath(
    app.isPackaged
      ? join(process.resourcesPath, "brand", "trayTemplate.png")
      : join(app.getAppPath(), ".brand", "tray", "trayTemplate.png")
  );
  const image = branded.isEmpty() ? nativeImage.createEmpty() : branded;
  if (branded.isEmpty()) {
    for (const scaleFactor of [1, 2]) {
      image.addRepresentation(drawTrayIcon(scaleFactor));
    }
  }
  image.setTemplateImage(true);
  return image;
};

const main = async () => {
  // The brand's name in the menus, About and Quit, and the userData folder
  // under it (a packaged app gets both from its bundle; this makes a dev run
  // match). macOS's menu bar title in a dev run stays the Electron bundle's.
  app.setName(build.name);
  app.setPath(
    "userData",
    env.DESKTOP_USER_DATA ?? join(app.getPath("appData"), build.name)
  );
  if (platform === "win") {
    // Notifications and the taskbar group under the installer's app ID.
    app.setAppUserModelId(build.appId);
  }
  // Every renderer sandboxed, whatever a window asks for.
  app.enableSandbox();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  if (!app.isPackaged && platform === "mac") {
    // A dev run's Dock icon is Electron's; show the brand's instead.
    const icon = nativeImage.createFromPath(
      join(app.getAppPath(), ".brand", "icon.png")
    );
    if (!icon.isEmpty()) {
      app.dock?.setIcon(icon);
    }
  }
  startAutoUpdate(build, app.isPackaged).catch((cause: unknown) => {
    console.error("[desktop] auto-update didn't start:", cause);
  });

  const path = settingsPath(app.getPath("userData"));
  let settings: Settings = await readSettings(path);
  // One write at a time: the window's bounds and a new instance can both
  // change settings, and each write goes through the same temporary file.
  let saving: Promise<void> = Promise.resolve();
  const saveSettings = (change: Partial<Settings>) => {
    settings = { ...settings, ...change };
    const next = settings;
    saving = saving
      .then(() => writeSettings(path, next))
      .catch((cause: unknown) => {
        console.error("[desktop] couldn't save settings:", cause);
      });
  };
  // `DESKTOP_INSTANCE_URL` wins for this run only; it's never saved.
  const preset = env.DESKTOP_INSTANCE_URL
    ? await checkInstance(env.DESKTOP_INSTANCE_URL, net.fetch)
    : null;
  let instance = preset?.ok ? preset.value : settings.instance;
  const origin = () => instance?.origin ?? null;

  let mainWindow: BrowserWindow | null = null;
  let setupWindow: BrowserWindow | null = null;

  const openExternal = (url: string) => {
    shell.openExternal(url).catch(() => undefined);
  };

  const instanceSession = session.fromPartition(INSTANCE_PARTITION);
  guardSession(instanceSession, origin);
  guardSession(session.defaultSession, () => null);
  markUserAgent(instanceSession, app.getVersion());
  app.on("web-contents-created", (_event, contents) => {
    guardEveryContents(contents);
  });

  const openSetup = () => {
    if (setupWindow) {
      setupWindow.focus();
      return;
    }
    const window = new BrowserWindow({
      fullscreenable: false,
      height: 520,
      maximizable: false,
      resizable: false,
      show: false,
      title: "",
      webPreferences: webPreferences("setup"),
      width: 480,
    });
    setupWindow = window;
    guardContents(window.webContents, () => null, {
      openExternal,
      openInMain: openExternal,
    });
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      setupWindow = null;
      if (!mainWindow && platform !== "mac") {
        app.quit();
      }
    });
    // The dev server only in development: a packaged app never takes its
    // setup page (and that page's bridge) from the environment.
    if (env.ELECTRON_RENDERER_URL && !app.isPackaged) {
      window.loadURL(env.ELECTRON_RENDERER_URL).catch(() => undefined);
    } else {
      window
        .loadFile(
          fileURLToPath(new URL("../renderer/index.html", import.meta.url))
        )
        .catch(() => undefined);
    }
  };

  const openInstance = (target: string) => {
    if (mainWindow) {
      mainWindow.loadURL(target).catch(() => undefined);
      mainWindow.focus();
      return;
    }
    const placement = placeWindow({
      ...MAIN_WINDOW,
      saved: settings.window,
      workAreas: [
        screen.getPrimaryDisplay().workArea,
        ...screen.getAllDisplays().map((display) => display.workArea),
      ],
    });
    const window = new BrowserWindow({
      ...placement.bounds,
      minHeight: MAIN_WINDOW.minimum.height,
      minWidth: MAIN_WINDOW.minimum.width,
      show: false,
      title: instance?.name ?? "",
      // macOS (117, D14): no title bar, the traffic lights inset over the
      // web app's header, which drags the window and leaves them room.
      // Windows and Linux keep the native frame until their custom bar.
      ...(platform === "mac"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 17 },
          }
        : {}),
      webPreferences: webPreferences("instance", INSTANCE_PARTITION),
    });
    mainWindow = window;
    if (placement.maximized) {
      window.maximize();
    }
    // Remember where it was, once it settles and when it closes.
    let boundsTimer: NodeJS.Timeout | undefined;
    const saveBounds = () => {
      clearTimeout(boundsTimer);
      if (!(window.isDestroyed() || window.isFullScreen())) {
        saveSettings({
          window: windowStateOf(window.getNormalBounds(), window.isMaximized()),
        });
      }
    };
    const saveBoundsSoon = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(saveBounds, SAVE_BOUNDS_MS);
    };
    window.on("resize", saveBoundsSoon);
    window.on("move", saveBoundsSoon);
    window.on("maximize", saveBoundsSoon);
    window.on("unmaximize", saveBoundsSoon);
    window.on("close", saveBounds);
    guardContents(window.webContents, origin, {
      openExternal,
      openInMain: (url) => {
        window.loadURL(url).catch(() => undefined);
      },
    });
    window.once("ready-to-show", () => window.show());
    // The instance is down or moved: offer the setup screen to retry or
    // switch, rather than leave an empty window. -3 is a navigation the
    // page itself aborted, not a failure.
    window.webContents.on(
      "did-fail-load",
      (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) {
          openSetup();
        }
      }
    );
    window.on("closed", () => {
      mainWindow = null;
      // The hidden Quick AI window would otherwise keep the app running
      // where closing the last window quits it.
      if (platform !== "mac" && !setupWindow) {
        app.quit();
      }
    });
    window.loadURL(target).catch(() => undefined);
  };

  /** Brings the main window forward, showing `target` when given (118). */
  const showMain = (target?: string) => {
    const current = origin();
    if (!current) {
      openSetup();
      return;
    }
    if (!mainWindow) {
      openInstance(target ?? current);
      return;
    }
    if (target) {
      mainWindow.loadURL(target).catch(() => undefined);
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  };

  const quick = createQuickAi({
    openExternal,
    openInMain: showMain,
    origin,
    platform,
    webPreferences: webPreferences("instance", INSTANCE_PARTITION),
  });
  // Before an instance is chosen there's nothing to ask: the setup screen.
  const toggleQuick = () => {
    if (origin()) {
      quick.toggle();
    } else {
      openSetup();
    }
  };

  const fromSetup = (event: IpcMainInvokeEvent) =>
    setupWindow !== null &&
    event.sender === setupWindow.webContents &&
    event.senderFrame === event.sender.mainFrame;

  // Escape on the Quick AI page. Only that window's own page may hide it.
  ipcMain.on(channels.quickHide, (event) => {
    const window = quick.window();
    if (
      window !== null &&
      event.sender === window.webContents &&
      event.senderFrame === event.sender.mainFrame
    ) {
      quick.hide();
    }
  });

  ipcMain.handle(channels.setupCurrent, (event): CurrentInstance => {
    if (!fromSetup(event)) {
      throw new Error("setup:current from outside the setup window");
    }
    return { origin: origin() };
  });

  ipcMain.handle(
    channels.setupConnect,
    async (event, payload: unknown): Promise<ConnectResult> => {
      if (!fromSetup(event)) {
        throw new Error("setup:connect from outside the setup window");
      }
      const input = connectInputSchema.safeParse(payload);
      if (!input.success) {
        return { error: "invalid", ok: false };
      }
      const result = await checkInstance(input.data.url, net.fetch);
      if (result.ok) {
        instance = result.value;
        saveSettings({ instance: result.value });
        await saving;
        // The Quick AI page belonged to the old instance.
        quick.destroy();
        openInstance(result.value.origin);
        // After the reply is on its way, so the page sees it.
        setImmediate(() => setupWindow?.close());
      }
      return result;
    }
  );

  const i18n = i18nForSystem(app.getPreferredSystemLanguages());
  // To the instance's page, which runs it as its shortcut. Nothing to do
  // while only the setup screen is open.
  const runShortcut = (id: MenuCommand) => {
    mainWindow?.webContents.send(
      channels.menuCommand,
      menuCommandSchema.parse(id)
    );
  };

  // The global shortcut (118). One that can't be had (another app holds
  // it, or settings.json names something unusable) is reported once, and
  // Quick AI stays on the menus and the menu bar icon.
  let registered: QuickShortcut | null = null;
  const takeQuickShortcut = (setting: QuickShortcutSetting): QuickShortcut => {
    const next = parseQuickShortcut(setting);
    const outcome = applyQuickShortcut({
      next,
      onPress: toggleQuick,
      port: {
        register: (accelerator, onPress) =>
          globalShortcut.register(accelerator, onPress),
        unregister: (accelerator) => globalShortcut.unregister(accelerator),
      },
      previous: registered,
    });
    registered = outcome.kind === "registered" ? next : null;
    const message = registrationMessage(outcome, { i18n, platform });
    if (message) {
      dialog
        .showMessageBox({ ...message, type: "warning" })
        .catch(() => undefined);
    }
    return next;
  };
  let quickShortcut = takeQuickShortcut(settings.quickAi.shortcut);

  // The menu bar icon (macOS, 117 and 118), from the brand's logo (119).
  let tray: Tray | null = null;
  let trayMenu: Menu | null = null;
  if (platform === "mac") {
    tray = new Tray(trayImage());
    tray.setToolTip(instance?.name ?? app.name);
  }

  const buildMenus = () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        menuTemplate({
          actions: {
            changeInstance: openSetup,
            runShortcut,
            setQuickShortcut,
            toggleQuick,
          },
          appName: app.name,
          i18n,
          platform,
          quickShortcut,
        })
      )
    );
    if (tray) {
      trayMenu = Menu.buildFromTemplate(
        trayMenuTemplate({
          actions: {
            newChat: () => {
              const open = mainWindow !== null;
              showMain();
              if (open) {
                runShortcut("chat.new");
              }
            },
            quit: () => app.quit(),
            showWindow: () => showMain(),
            toggleQuick,
          },
          i18n,
          quickShortcut,
        })
      );
      tray.setContextMenu(trayMenu);
    }
  };
  function setQuickShortcut(setting: QuickShortcutSetting) {
    quickShortcut = takeQuickShortcut(setting);
    saveSettings({ quickAi: { shortcut: setting } });
    buildMenus();
  }
  buildMenus();

  if (env.DESKTOP_TEST_HOOKS) {
    Object.assign(globalThis, {
      __desktopTest: {
        quickShortcut: () =>
          registered?.kind === "on" ? registered.accelerator : null,
        // A shortcut the menu doesn't offer, as settings.json could name.
        setQuickShortcut,
        trayMenu: () => trayMenu,
      },
    });
  }

  // Quitting closes every window; the Quick AI window would only hide.
  app.on("before-quit", () => {
    quick.destroy();
  });
  // A global shortcut outlives nothing: released however the app ends.
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
  });

  app.on("second-instance", () => {
    const window = mainWindow ?? setupWindow;
    if (window?.isMinimized()) {
      window.restore();
    }
    window?.focus();
  });
  app.on("activate", () => {
    if (mainWindow || setupWindow) {
      return;
    }
    const current = origin();
    if (current) {
      openInstance(current);
    } else {
      openSetup();
    }
  });
  app.on("window-all-closed", () => {
    if (platform !== "mac") {
      app.quit();
    }
  });

  const start = origin();
  if (start && parseInstanceUrl(start).ok) {
    openInstance(start);
  } else {
    openSetup();
  }
};

main().catch((cause: unknown) => {
  console.error("[desktop] failed to start:", cause);
  app.exit(1);
});
