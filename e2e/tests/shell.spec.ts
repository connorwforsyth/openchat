import { expect, type Page, test } from "@playwright/test";

import { BRAND_NAME } from "../support/brand";
import { composer } from "../support/chat";
import { clickHydrated } from "../support/hydration";
import {
  LIBRARY_URL,
  SETTINGS_URL,
  SIGN_IN_FOR_LIBRARY_URL,
  SIGN_IN_URL,
} from "../support/urls";
import { signIn, storageStateFor, users } from "../support/users";

// The signed-in shell (039): sign-out and back in, sign-in at another
// loopback name (054), a stale session cookie, the persisted query cache
// (D28: gone after sign-out), the sidebar's collapsed state restored before
// paint, the instance's name from config, and library, settings and admin
// rendered inside the one shell.

const PERSISTED_KEY = "query-cache";

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
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await page.goto("/settings/profile");
    await expect(chats).toBeVisible();
    await expect(page.getByText(users.ada.email)).toBeVisible();

    await page.goto("/admin");
    await expect(chats).toBeVisible();
    await expect(page.getByRole("link", { name: "Acme" })).toBeVisible();
    await page.getByRole("link", { name: "Acme" }).click();
    await expect(page.getByRole("link", { name: "Members" })).toBeVisible();
    await expect(chats).toBeVisible();
  });

  test("⌘K opens the palette from anywhere and runs an action", async ({
    page,
  }) => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    // The palette loads after boot (composer:ready on chat pages).
    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+K");
      await expect(
        page.getByPlaceholder("Search or type a command…")
      ).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.getByPlaceholder("Search or type a command…").fill("settings");
    await page.getByRole("option", { name: "Open settings" }).click();
    await expect(page).toHaveURL(SETTINGS_URL);
  });
});
