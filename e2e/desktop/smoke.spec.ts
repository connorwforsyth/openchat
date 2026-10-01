import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";

import { expectReply, send } from "../support/chat";
import { hydrated } from "../support/hydration";
import { CHAT_URL, HOME_URL, SIGN_IN_URL } from "../support/urls";
import { users } from "../support/users";
import { desktopBaseUrl } from "./port";

// Ticket 116: the shell end to end. First run asks for the server; the
// window then shows the server's own web app, where its own sign-in works
// and a chat streams a reply from the mock model. Along the way, the D24
// locks: the bridge is the tiny one, other origins leave for the system
// browser (stubbed here, so nothing opens on the screen), and permissions
// the instance doesn't need are denied. Ticket 117: the native menus, built
// from the shortcut registry, drive the web app; the header is the title
// bar; the window's bounds are remembered.

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
  const app = await electron.launch({
    args: [desktopApp],
    env: { ...process.env, DESKTOP_USER_DATA: userData },
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
  } finally {
    await app.close();
    await rm(userData, { force: true, recursive: true });
  }
});

declare global {
  interface Window {
    /** The instance preload's bridge (apps/desktop/src/preload/instance.ts). */
    readonly desktop?: { readonly platform: string };
  }
}
