import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";

import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { hydrated } from "../support/hydration";
import { CHAT_URL, HOME_URL, QUICK_URL, SIGN_IN_URL } from "../support/urls";
import { users } from "../support/users";
import { desktopBaseUrl } from "./port";

// Ticket 116: the shell end to end. First run asks for the server; the
// window then shows the server's own web app, where its own sign-in works
// and a chat streams a reply from the mock model. Along the way, the D24
// locks: the bridge is the tiny one, other origins leave for the system
// browser (stubbed here, so nothing opens on the screen), and permissions
// the instance doesn't need are denied. Ticket 117: the native menus, built
// from the shortcut registry, drive the web app; the header is the title
// bar; the window's bounds are remembered. Ticket 118: Quick AI, opened from
// the menu bar icon and the app menu (a global shortcut can't be pressed
// here), answers in its own window or hands the chat to the main one; its
// shortcut is registered, reported when taken, and released on quit.

/**
 * The Quick AI shortcut for this run: one nobody uses, so the test never
 * takes a key from the person at the machine. Set in settings.json, as a
 * person would.
 */
const TEST_SHORTCUT = "Ctrl+Alt+Shift+F12";
const TEST_ACCELERATOR = "Control+Alt+Shift+F12";
/** One the test holds itself, to see a taken shortcut reported. */
const TAKEN_SHORTCUT = "Ctrl+Alt+Shift+F11";
const TAKEN_ACCELERATOR = "Control+Alt+Shift+F11";

interface TestHooks {
  readonly quickShortcut: () => string | null;
  readonly setQuickShortcut: (setting: string | null) => void;
  readonly trayMenu: () => Electron.Menu | null;
}

const desktopApp = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/desktop"
);
const user = users.ada;

/** Replaces `shell.openExternal` in main with a recorder. */
const recordExternalOpens = (app: ElectronApplication) =>
  app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { __opened: opened });
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });

/** Clicks a native menu item, as the person would from the menu bar. */
const clickMenu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) {
      throw new Error(`no menu item ${itemId}`);
    }
    item.click();
  }, id);

/** Clicks an item in the menu bar icon's menu. */
const clickTray = (app: ElectronApplication, id: string) =>
  app.evaluate((_electron, itemId) => {
    const hooks = (globalThis as unknown as { __desktopTest: TestHooks })
      .__desktopTest;
    const item = hooks.trayMenu()?.getMenuItemById(itemId);
    if (!item) {
      throw new Error(`no tray item ${itemId}`);
    }
    item.click();
  }, id);

/** The Quick AI window's state, from main. */
const quickWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((each) =>
      each.webContents.getURL().endsWith("/quick")
    );
    if (!window) {
      return null;
    }
    const bounds = window.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    return {
      alwaysOnTop: window.isAlwaysOnTop(),
      bounds,
      resizable: window.isResizable(),
      visible: window.isVisible(),
      workArea,
    };
  });

const quickVisible = async (app: ElectronApplication) =>
  (await quickWindow(app))?.visible ?? false;

const externalOpens = (app: ElectronApplication) =>
  app.evaluate(
    () => (globalThis as unknown as { __opened: string[] }).__opened
  );

test("first run, sign-in and a chat in the desktop shell", async ({
  request,
}) => {
  // The seeded account: the first sign-up on a fresh server.
  const signUp = await request.post(
    `${desktopBaseUrl}/api/auth/sign-up/email`,
    {
      data: { email: user.email, name: user.name, password: user.password },
      headers: { origin: desktopBaseUrl },
    }
  );
  expect(signUp.ok()).toBe(true);

  const userData = await mkdtemp(join(tmpdir(), "desktop-e2e-"));
  await writeFile(
    join(userData, "settings.json"),
    JSON.stringify({ quickAi: { shortcut: TEST_SHORTCUT } })
  );
  const released = join(userData, "shortcuts-released");
  const app = await electron.launch({
    args: [desktopApp],
    env: {
      ...process.env,
      DESKTOP_TEST_HOOKS: "1",
      DESKTOP_USER_DATA: userData,
    },
  });
  try {
    await recordExternalOpens(app);

    // First run: the setup screen, which refuses a plain-http remote server.
    const setup = await app.firstWindow();
    const address = setup.getByLabel("Server address");
    await (await hydrated(address)).fill("http://chat.example.com");
    await setup.getByRole("button", { name: "Connect" }).click();
    await expect(setup.getByRole("alert")).toContainText("https://");

    await address.fill(desktopBaseUrl);
    const opened = app.waitForEvent("window");
    await setup.getByRole("button", { name: "Connect" }).click();
    const page = await opened;

    // The server's own web app, signed out.
    await expect(page).toHaveURL(SIGN_IN_URL);
    expect(
      await page.evaluate(() => Object.keys(window.desktop ?? {}))
    ).toEqual(expect.arrayContaining(["onMenuCommand", "platform"]));
    expect(await page.evaluate(() => window.desktop?.platform)).toBe("mac");
    expect(await page.evaluate(() => "require" in window)).toBe(false);
    expect(await page.evaluate(() => navigator.userAgent)).toContain(
      "DesktopShell/"
    );

    // Its own sign-in, in the window.
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await (
      await hydrated(page.getByRole("button", { exact: true, name: "Sign in" }))
    ).click();
    await expect(page).toHaveURL(HOME_URL);

    // A chat: the mock model echoes, streamed over the run stream.
    await send(page, "Hello from the desktop shell");
    await expectReply(page, "Echo: Hello from the desktop shell");

    // The title bar (117): no native one on macOS, so the header drags the
    // window, its controls don't, and the sidebar's top row leaves the
    // traffic lights room.
    const header = page.locator('[data-slot="app-header"]');
    await expect(header).toHaveAttribute("data-platform", "mac");
    const appRegion = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) =>
          getComputedStyle(node).getPropertyValue("-webkit-app-region")
        );
    expect(await appRegion('[data-slot="app-header"]')).toBe("drag");
    expect(await appRegion('[data-slot="app-header"] button')).toBe("no-drag");
    const sidebar = page.locator('[data-slot="app-shell-sidebar"]');
    expect(
      await sidebar
        .locator('[data-slot="chat-sidebar-top"]')
        .evaluate((row) => getComputedStyle(row).paddingInlineStart)
    ).toBe("80px");
    expect(await appRegion('[data-slot="chat-sidebar-top"]')).toBe("drag");

    // The menus come from the registry: its labels and its keys.
    expect(
      await app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById("palette.open");
        return [item?.label, item?.accelerator];
      })
    ).toEqual(["Open the command palette", "CommandOrControl+K"]);

    // A menu command reaches the web app and runs the shortcut's handler:
    // the sidebar, the palette, a new chat.
    await expect(sidebar).toBeVisible();
    await clickMenu(app, "sidebar.toggle");
    await expect(sidebar).toBeHidden();
    await clickMenu(app, "sidebar.toggle");
    await expect(sidebar).toBeVisible();

    const search = page.getByPlaceholder("Search or type a command…");
    // The palette loads after boot; until then nothing answers the command.
    await expect(async () => {
      if (!(await search.isVisible())) {
        await clickMenu(app, "palette.open");
      }
      await expect(search).toBeVisible({ timeout: 1000 });
    }).toPass();
    await search.press("Escape");
    await expect(search).toBeHidden();

    await expect(page).toHaveURL(CHAT_URL);
    await clickMenu(app, "chat.new");
    await expect(page).toHaveURL(HOME_URL);

    // The window's bounds are saved once it settles, for the next launch.
    await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      window?.setBounds({ height: 700, width: 1000, x: 40, y: 60 });
    });
    const settingsFile = join(userData, "settings.json");
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(settingsFile, "utf8"));
        return saved.window;
      })
      .toMatchObject({ height: 700, maximized: false, width: 1000, x: 40 });

    // Other origins go to the system browser; the window stays put.
    const here = page.url();
    await page.evaluate(() => {
      window.open("https://example.com/from-window-open");
    });
    await page.evaluate(() => {
      window.location.href = "https://example.com/from-navigation";
    });
    await expect
      .poll(() => externalOpens(app))
      .toEqual([
        "https://example.com/from-window-open",
        "https://example.com/from-navigation",
      ]);
    await page.evaluate(() => {
      window.location.href = "file:///etc/hosts";
    });
    expect(page.url()).toBe(here);
    expect(await externalOpens(app)).toHaveLength(2);

    // Permissions the instance has no use for are denied.
    expect(
      await page.evaluate(
        async () =>
          (await navigator.permissions.query({ name: "geolocation" })).state
      )
    ).toBe("denied");

    // Quick AI (118). The shortcut from settings.json is registered, and
    // the menus show it.
    expect(
      await app.evaluate(
        ({ globalShortcut }, accelerator) =>
          globalShortcut.isRegistered(accelerator),
        TEST_ACCELERATOR
      )
    ).toBe(true);
    expect(
      await app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById("quick-ai");
        return [item?.label, item?.accelerator];
      })
    ).toEqual(["Quick AI", TEST_ACCELERATOR]);

    // The menu bar icon's menu.
    expect(
      await app.evaluate(() =>
        (globalThis as unknown as { __desktopTest: TestHooks }).__desktopTest
          .trayMenu()
          ?.items.map((item) => item.label || item.type)
      )
    ).toEqual(["New chat", "Quick AI", "Show Window", "separator", "Quit"]);

    // Quick AI from the menu bar icon: a floating window on /quick,
    // centred across the display it opens on.
    const quickOpened = app.waitForEvent("window");
    await clickTray(app, "tray:quick-ai");
    const quick = await quickOpened;
    await expect(quick).toHaveURL(QUICK_URL);
    await expect.poll(() => quickVisible(app)).toBe(true);
    const shown = await quickWindow(app);
    expect(shown).toMatchObject({ alwaysOnTop: true, resizable: false });
    if (shown) {
      const { bounds, workArea } = shown;
      expect(
        Math.abs(
          bounds.x + bounds.width / 2 - (workArea.x + workArea.width / 2)
        )
      ).toBeLessThanOrEqual(1);
    }
    // The same bridge as the main window, and none of the app's chrome.
    expect(
      await quick.evaluate(() => Object.keys(window.desktop ?? {}))
    ).toEqual(expect.arrayContaining(["onMenuCommand", "platform"]));
    await expect(quick.locator('[data-slot="app-header"]')).toHaveCount(0);
    const heightBefore = shown?.bounds.height ?? 0;

    // Send: a new chat, answered here, compactly.
    await send(quick, "Quick hello from the menu bar");
    const reply = quick.locator('[data-slot="quick-reply"]');
    await expect(reply).toContainText("Echo: Quick hello from the menu bar");
    await expect(quick).toHaveURL(QUICK_URL);
    // The window follows the page's height. (Chromium reports it, but not
    // while Playwright drives the page, so the report is played here.)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((each) =>
        each.webContents.getURL().endsWith("/quick")
      );
      window?.webContents.emit(
        "preferred-size-changed",
        {},
        { height: 300, width: 680 }
      );
    });
    await expect
      .poll(async () => (await quickWindow(app))?.bounds.height)
      .toBe(300);

    // Links from it leave the way the main window's do.
    await quick.evaluate(() => {
      window.open("https://example.com/from-quick");
    });
    await expect
      .poll(() => externalOpens(app))
      .toContain("https://example.com/from-quick");

    // Escape hides it; the app menu's Quick AI brings it back as it was.
    await composer(quick).press("Escape");
    await expect.poll(() => quickVisible(app)).toBe(false);
    // Hidden, it shrinks, so the page measures itself afresh.
    expect((await quickWindow(app))?.bounds.height).toBe(heightBefore);
    await clickMenu(app, "quick-ai");
    await expect.poll(() => quickVisible(app)).toBe(true);
    await expect(reply).toContainText("Echo: Quick hello from the menu bar");

    // ⌘⏎ sends and opens the chat in the main window, where the reply
    // carries on; the Quick AI window gets out of the way.
    await composerReady(quick);
    await composer(quick).click();
    await composer(quick).pressSequentially("Quick to the main window");
    await composer(quick).press("Meta+Enter");
    await expect(page).toHaveURL(CHAT_URL);
    await conversationIdOf(page);
    await expectReply(page, "Echo: Quick to the main window");
    await expect.poll(() => quickVisible(app)).toBe(false);

    // Opened again, it's back on /quick with an empty composer.
    await clickMenu(app, "quick-ai");
    await expect.poll(() => quickVisible(app)).toBe(true);
    await expect(quick).toHaveURL(QUICK_URL);
    await expect(quick.locator('[data-slot="quick-turn"]')).toHaveCount(0);
    await composer(quick).press("Escape");
    await expect.poll(() => quickVisible(app)).toBe(false);

    // A shortcut another app holds is reported, and none is registered;
    // Quick AI stays on the menus.
    await app.evaluate(({ dialog }) => {
      const shownMessages: string[] = [];
      Object.assign(globalThis, { __messages: shownMessages });
      dialog.showMessageBox = ((options: Electron.MessageBoxOptions) => {
        shownMessages.push(options.message);
        return Promise.resolve({ checkboxChecked: false, response: 0 });
      }) as typeof dialog.showMessageBox;
    });
    await app.evaluate(
      ({ globalShortcut }, accelerator) =>
        globalShortcut.register(accelerator, () => undefined),
      TAKEN_ACCELERATOR
    );
    await app.evaluate((_electron, setting) => {
      (
        globalThis as unknown as { __desktopTest: TestHooks }
      ).__desktopTest.setQuickShortcut(setting);
    }, TAKEN_SHORTCUT);
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { __messages: string[] }).__messages
      )
    ).toEqual(["Another app is using ⌃⌥⇧F11, so it can't open Quick AI."]);
    expect(
      await app.evaluate(() =>
        (
          globalThis as unknown as { __desktopTest: TestHooks }
        ).__desktopTest.quickShortcut()
      )
    ).toBeNull();
    // The old one was released.
    expect(
      await app.evaluate(
        ({ globalShortcut }, accelerator) =>
          globalShortcut.isRegistered(accelerator),
        TEST_ACCELERATOR
      )
    ).toBe(false);
    await app.evaluate(
      ({ globalShortcut }, accelerator) =>
        globalShortcut.unregister(accelerator),
      TAKEN_ACCELERATOR
    );

    // Choosing from the menu registers it and saves it.
    await app.evaluate((_electron, setting) => {
      (
        globalThis as unknown as { __desktopTest: TestHooks }
      ).__desktopTest.setQuickShortcut(setting);
    }, TEST_SHORTCUT);
    await clickMenu(app, "quick-shortcut:off");
    expect(
      await app.evaluate(
        ({ globalShortcut }, accelerator) =>
          globalShortcut.isRegistered(accelerator),
        TEST_ACCELERATOR
      )
    ).toBe(false);
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(settingsFile, "utf8"));
        return saved.quickAi;
      })
      .toEqual({ shortcut: null });
    await app.evaluate((_electron, setting) => {
      (
        globalThis as unknown as { __desktopTest: TestHooks }
      ).__desktopTest.setQuickShortcut(setting);
    }, TEST_SHORTCUT);

    // Quitting releases the shortcut (the hidden Quick AI window doesn't
    // hold the app open either: close() below would time out).
    await app.evaluate(({ globalShortcut }, marker) => {
      const fs = process.getBuiltinModule("node:fs");
      const release = globalShortcut.unregisterAll.bind(globalShortcut);
      globalShortcut.unregisterAll = () => {
        fs.writeFileSync(marker, "released");
        release();
      };
    }, released);
  } finally {
    await app.close();
  }
  try {
    expect(await readFile(released, "utf8")).toBe("released");
  } finally {
    await rm(userData, { force: true, recursive: true });
  }
});

declare global {
  interface Window {
    /** The instance preload's bridge (apps/desktop/src/preload/instance.ts). */
    readonly desktop?: { readonly platform: string };
  }
}
