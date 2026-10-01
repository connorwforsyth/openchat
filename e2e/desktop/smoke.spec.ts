import { mkdtemp, rm } from "node:fs/promises";
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
import { HOME_URL, SIGN_IN_URL } from "../support/urls";
import { users } from "../support/users";
import { desktopBaseUrl } from "./port";

// Ticket 116: the shell end to end. First run asks for the server; the
// window then shows the server's own web app, where its own sign-in works
// and a chat streams a reply from the mock model. Along the way, the D24
// locks: the bridge is the tiny one, other origins leave for the system
// browser (stubbed here, so nothing opens on the screen), and permissions
// the instance doesn't need are denied.

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
