import { expect, type Page, test } from "@playwright/test";

import { BRAND_NAME } from "../support/brand";
import { chatHeader, composer, composerReady } from "../support/chat";
import { clickHydrated } from "../support/hydration";
import { PALETTE_KEY } from "../support/keys";
import {
  SETTINGS_URL,
  SIGN_IN_FOR_LIBRARY_URL,
  SIGN_IN_URL,
} from "../support/urls";
import { signIn, storageStateFor, users } from "../support/users";

const KEYS_URL = /\/settings\/keys$/;
const HOME_URL = /\/$/;
const LIBRARY_URL = /\/library$/;
const SPACE_POLICIES_URL = /\/settings\/space-policies\?space=org%3A/;
// The signed-in shell (039): sign-out and back in, sign-in at another
// loopback name (054), a stale session cookie, the persisted query cache
// (D28: gone after sign-out), the sidebar's collapsed state restored before
// paint, the instance's name from config, and library, settings and admin
// rendered inside the one shell.

const PERSISTED_KEY = "query-cache";
const SANDBOX_PILL = /^Sandbox/;

/** What idb-keyval's default store holds under the persisted cache's key. */
const persistedCache = (page: Page) =>
  page.evaluate(
    (key) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => reject(open.error);
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(false);
            return;
          }
          const read = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get(key);
          read.onsuccess = () => {
            db.close();
            resolve(read.result !== undefined);
          };
          read.onerror = () => reject(read.error);
        };
      }),
    PERSISTED_KEY
  );

test.describe("session", () => {
  // A fresh browser (no saved state): signing out ends this session only.
  test("sign out clears the persisted cache; signing in again works", async ({
    page,
  }) => {
    const answer = await signIn(page, users.cy);
    expect(answer.status()).toBe(200);
    await expect(composer(page)).toBeVisible();
    // The sidebar's queries are written to IndexedDB (batched, ~1 s).
    await expect.poll(() => persistedCache(page)).toBe(true);

    await clickHydrated(
      page.getByRole("button", { name: `Account: ${users.cy.name}` })
    );
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(SIGN_IN_URL);
    expect(await persistedCache(page)).toBe(false);

    // Signed out, the app is closed to this browser.
    await page.goto("/library");
    await expect(page).toHaveURL(SIGN_IN_FOR_LIBRARY_URL);
    await signIn(page, users.cy, "/library");
    await expect(page).toHaveURL(LIBRARY_URL);
  });

  // 054: serve.ts sets BETTER_AUTH_URL to http://localhost:<port>. The same
  // server opened as 127.0.0.1 signs in too; a name that isn't a loopback
  // alias (Chromium sends *.localhost to this machine as well) is refused,
  // and the form names the address to open instead.
  test("signs in at 127.0.0.1 too, and names the address when refused", async ({
    baseURL,
    browser,
  }) => {
    const { port } = new URL(baseURL ?? "");
    const loopback = await browser.newContext({
      baseURL: `http://127.0.0.1:${port}`,
    });
    const page = await loopback.newPage();
    const answer = await signIn(page, users.cy);
    expect(answer.status()).toBe(200);
    await expect(composer(page)).toBeVisible();
    await loopback.close();

    const elsewhere = await browser.newContext({
      baseURL: `http://e2e.localhost:${port}`,
    });
    const visitor = await elsewhere.newPage();
    const refused = await signIn(visitor, users.cy);
    expect(refused.status()).toBe(403);
    await expect(
      visitor.getByText("This address isn't allowed to sign in.", {
        exact: false,
      })
    ).toBeVisible();
    await expect(
      visitor.getByRole("link", { name: `http://localhost:${port}` })
    ).toHaveAttribute("href", `http://localhost:${port}/sign-in?next=%2F`);
    await elsewhere.close();
  });

  test("a stale session cookie goes to sign-in, not an error", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      {
        domain: "localhost",
        name: "better-auth.session_token",
        path: "/",
        value: "stale-session.not-a-real-signature",
      },
    ]);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(SIGN_IN_URL);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await context.close();
  });
});

test.describe("shell", () => {
  test.use({ storageState: storageStateFor("ada") });

  test("a collapsed sidebar stays collapsed across a reload, with no flash", async ({
    page,
  }) => {
    await page.goto("/");
    const sidebar = page.locator('[data-slot="app-shell-sidebar"]');
    await expect(sidebar).toBeVisible();
    await clickHydrated(page.getByRole("button", { name: "Toggle sidebar" }));
    await expect(sidebar).toBeHidden();

    // Watch the sidebar from the first parsed byte: was it ever painted?
    await page.addInitScript(() => {
      const seen = { shown: false };
      (window as unknown as { __sidebar: typeof seen }).__sidebar = seen;
      const check = () => {
        const node = document.querySelector('[data-slot="app-shell-sidebar"]');
        if (node && getComputedStyle(node).display !== "none") {
          const box = node.getBoundingClientRect();
          seen.shown ||= box.width > 0 && box.height > 0;
        }
      };
      new MutationObserver(check).observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      const frame = () => {
        check();
        if (document.readyState !== "complete") {
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
    });
    await page.reload();
    await expect(composer(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-sidebar",
      "closed"
    );
    await expect(sidebar).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __sidebar: { shown: boolean } }).__sidebar
            .shown
      )
    ).toBe(false);

    // Open it again for the specs that follow.
    await clickHydrated(page.getByRole("button", { name: "Toggle sidebar" }));
    await expect(sidebar).toBeVisible();
  });

  // D14 after tickets 057 and 137: the header ends with Share, Files and the
  // Browser (no sandbox pill, no Artifacts button), and a new chat opens on
  // the template-style empty state with its suggestions.
  test("the chat header keeps to Share, Files and Browser", async ({
    page,
  }) => {
    await page.goto("/");
    await composerReady(page);
    await expect(page.getByText("What can I help with?")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Suggestions" }).getByRole("button")
    ).toHaveCount(4);

    const header = chatHeader(page);
    await expect(header.getByRole("button", { name: "Share" })).toBeVisible();
    // 113: no rule under it and no New chat. 181: the sidebar's toggle is
    // the rail's first button, not the header's or the sidebar's.
    await expect(header).toHaveCSS("border-bottom-width", "0px");
    await expect(header.getByRole("button", { name: "New chat" })).toHaveCount(
      0
    );
    await expect(
      header.getByRole("button", { name: "Toggle sidebar" })
    ).toHaveCount(0);
    const rail = page.getByRole("navigation", { name: "Sidebar rail" });
    await expect(rail.getByRole("button").first()).toHaveAccessibleName(
      "Toggle sidebar"
    );
    await expect(
      page.getByRole("button", { name: "Toggle sidebar" })
    ).toHaveCount(1);
    await expect(
      header.getByRole("button", { name: SANDBOX_PILL })
    ).toHaveCount(0);
    const files = header.getByRole("button", { exact: true, name: "Files" });
    const browser = header.getByRole("button", { name: "Browser" });
    await expect(files).toHaveAttribute("aria-pressed", "false");
    await expect(browser).toHaveAttribute("aria-pressed", "false");
    await files.click();
    await expect(files).toHaveAttribute("aria-pressed", "true");
    const panel = page.getByRole("complementary", { name: "Side panel" });
    await expect(panel).toBeVisible();
    // Before there's anything to preview, Browser shows the browser's
    // empty state.
    await browser.click();
    await expect(browser).toHaveAttribute("aria-pressed", "true");
    await expect(files).toHaveAttribute("aria-pressed", "false");
    await expect(panel.getByText("Nothing running yet")).toBeVisible();
    await browser.click();
    await expect(panel).toBeHidden();
  });

  // D18: the instance's name is `brand.name` from app.config.yaml (serve.ts
  // sets it), never a literal: the page title everywhere, the sidebar, and
  // the signed-out pages.
  test("the name comes from config", async ({ baseURL, browser, page }) => {
    for (const path of ["/", "/library", "/settings/profile"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one page, visited in turn.
      await page.goto(path);
      await expect(page).toHaveTitle(BRAND_NAME);
    }
    await expect(
      page
        .getByRole("complementary", { name: "Chats" })
        .getByText(BRAND_NAME, { exact: true })
    ).toBeVisible();

    const signedOut = await browser.newContext({ baseURL });
    const visitor = await signedOut.newPage();
    await visitor.goto("/sign-in");
    await expect(visitor).toHaveTitle(BRAND_NAME);
    await expect(visitor.getByText(BRAND_NAME, { exact: true })).toBeVisible();
    await signedOut.close();
  });

  test("library, settings and admin render inside the shell", async ({
    page,
  }) => {
    const chats = page.getByRole("complementary", { name: "Chats" });
    await page.goto("/library");
    await expect(chats).toBeVisible();
    // The page's title; the rail's Library panel has its own heading (181).
    await expect(
      page.getByRole("heading", { level: 1, name: "Library" })
    ).toBeVisible();

    // Settings is a full-screen view over a page (185); its address loads it
    // over the new chat.
    await page.goto("/settings/profile");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings.getByText(users.ada.email)).toBeVisible();
    await settings.getByRole("button", { name: "Provider keys" }).click();
    await expect(page).toHaveURL(KEYS_URL);
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(page).toHaveURL(HOME_URL);

    await page.goto("/admin");
    await expect(chats).toBeVisible();
    await expect(page.getByRole("link", { name: "Acme" })).toBeVisible();
    await page.getByRole("link", { name: "Acme" }).click();
    // An org's admin pages are its Space settings now, full-screen (187).
    await expect(page).toHaveURL(SPACE_POLICIES_URL);
    await expect(
      settings.getByRole("heading", { name: "Space: Acme" })
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: "Members" })
    ).toBeVisible();
    await expect(
      settings.getByRole("heading", { level: 1, name: "Policies" })
    ).toBeVisible();
  });

  test("⌘K opens the palette from anywhere and runs an action", async ({
    page,
  }) => {
    await page.goto("/library");
    // The page's title; the rail's Library panel has its own heading (181).
    const title = page.getByRole("heading", { level: 1, name: "Library" });
    await expect(title).toBeVisible();
    // The palette loads after boot (composer:ready on chat pages).
    await expect(async () => {
      await page.keyboard.press(PALETTE_KEY);
      await expect(
        page.getByPlaceholder("Search or type a command…")
      ).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.getByPlaceholder("Search or type a command…").fill("settings");
    await page.getByRole("option", { name: "Open settings" }).click();
    await expect(page).toHaveURL(SETTINGS_URL);
    // Over the page it was opened from; closing goes back to it.
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    // The modal hides the page from the accessibility tree, not the DOM.
    await expect(page.locator("h1", { hasText: "Library" })).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(LIBRARY_URL);
    await expect(title).toBeVisible();
  });
});
