import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  net,
  session,
  shell,
} from "electron";

import { parseInstanceUrl } from "../shared/instance-url";
import {
  type ConnectResult,
  type CurrentInstance,
  channels,
  connectInputSchema,
  platformOf,
} from "../shared/ipc";
import { parseDesktopEnv } from "./env";
import { i18nForSystem } from "./i18n";
import { checkInstance } from "./instance";
import { menuTemplate } from "./menu";
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

// The desktop shell (ticket 116). Instance URL only (122): the main window
// shows the instance's own web app, signed in with its own cookies in a
// persistent partition. The one local page is the first-run screen that asks
// which instance to use. Electron's wiring lives here; the rules it applies
// are pure functions in src/shared and src/main.

const env = parseDesktopEnv(process.env);
const platform = platformOf(process.platform);
const INSTANCE_PARTITION = "persist:instance";

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

const main = async () => {
  if (env.DESKTOP_USER_DATA) {
    app.setPath("userData", env.DESKTOP_USER_DATA);
  }
  // Every renderer sandboxed, whatever a window asks for.
  app.enableSandbox();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();

  const path = settingsPath(app.getPath("userData"));
  let settings: Settings = await readSettings(path);
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
    if (env.ELECTRON_RENDERER_URL) {
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
    const window = new BrowserWindow({
      height: 860,
      minHeight: 480,
      minWidth: 720,
      show: false,
      title: instance?.name ?? "",
      webPreferences: webPreferences("instance", INSTANCE_PARTITION),
      width: 1280,
    });
    mainWindow = window;
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
    });
    window.loadURL(target).catch(() => undefined);
  };

  const fromSetup = (event: IpcMainInvokeEvent) =>
    setupWindow !== null &&
    event.sender === setupWindow.webContents &&
    event.senderFrame === event.sender.mainFrame;

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
        settings = { ...settings, instance: result.value };
        await writeSettings(path, settings);
        openInstance(result.value.origin);
        // After the reply is on its way, so the page sees it.
        setImmediate(() => setupWindow?.close());
      }
      return result;
    }
  );

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        actions: { changeInstance: openSetup },
        appName: app.name,
        i18n: i18nForSystem(app.getPreferredSystemLanguages()),
        platform,
      })
    )
  );

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
