import { expect, type Request, test } from "@playwright/test";

import { apiFor } from "../support/api";
import {
  assistantMessages,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
  userMessages,
} from "../support/chat";
import { recordBootTimings, recordTiming } from "../support/timings";
import { storageStateFor } from "../support/users";

// Ticket 103 (D27): a chat opened cold (a new device, or after the persisted
// cache is cleared) gets its messages from the server, in the page's own
// response, with no extra round trip after hydration. A chat the person
// can't read seeds nothing.

test.use({ storageState: storageStateFor("ada") });

const QUESTION = "Seeded cold open quokka";
const REPLY = `Echo: ${QUESTION}`;
/** A message row as the server rendered it (not the data behind one). */
const HYDRATION = /hydrat|did not match|Minified React error #418/i;
const RENDERED_ROW = /data-message-id="[^"]+"/g;

/** A request for the stored branch, on its own or inside a batch. */
const fetchesPath = (request: Request, id: string): boolean =>
  decodeURIComponent(`${request.url()} ${request.postData() ?? ""}`).includes(
    `/conversations/${id}/path`
  );

/** Whether the persisted query cache (idb-keyval's default store) has been written. */
const hasPersistedCache = () =>
  new Promise<boolean>((resolve) => {
    const open = indexedDB.open("keyval-store");
    open.onerror = () => resolve(false);
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
        .get("query-cache");
      read.onsuccess = () => {
        db.close();
        resolve(read.result !== undefined);
      };
      read.onerror = () => {
        db.close();
        resolve(false);
      };
    };
  });

test("a chat opened cold has its messages in the server's HTML, with no client fetch for them", async ({
  baseURL,
  browser,
  page,
}) => {
  await page.goto("/");
  await send(page, QUESTION);
  await expectReply(page, REPLY);
  const id = await conversationIdOf(page);

  // A fresh browser: signed in, nothing in IndexedDB.
  const cold = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });

  const tab = await cold.newPage();
  // When the first message is visible, timed inside the page from the
  // navigation's start, like `composer:ready`; and whether the rows, once
  // shown, ever went away again (a flash between the server's rows, a
  // restored cache and the client's).
  await tab.addInitScript(() => {
    const holder = window as unknown as {
      __firstMessage?: number;
      __rowsDropped?: boolean;
    };
    const observer = new MutationObserver(() => {
      const shown = [...document.querySelectorAll("[data-message-id]")].some(
        (node) => node.checkVisibility()
      );
      if (shown) {
        holder.__firstMessage ??= performance.now();
      } else if (holder.__firstMessage !== undefined) {
        holder.__rowsDropped = true;
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  // The server's rows hydrate as they are: React reports any mismatch.
  const hydrationErrors: string[] = [];
  tab.on("console", (message) => {
    if (message.type() === "error" && HYDRATION.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  tab.on("pageerror", (error) => {
    if (HYDRATION.test(error.message)) {
      hydrationErrors.push(error.message);
    }
  });
  const pathFetches: string[] = [];
  tab.on("request", (request) => {
    if (fetchesPath(request, id)) {
      pathFetches.push(request.url());
    }
  });
  await tab.goto(`/c/${id}`);
  await expect(userMessages(tab)).toHaveCount(1);
  await expect(assistantMessages(tab).last()).toContainText(REPLY);
  await recordBootTimings(tab, "/c/[id] (cold)");
  const firstMessage = await tab.evaluate(
    () => (window as unknown as { __firstMessage?: number }).__firstMessage
  );
  expect(firstMessage).toBeDefined();
  await recordTiming("first message", firstMessage ?? 0, "/c/[id] (cold)");

  // Hydrated and settled: the browser never asked for the branch.
  await composerReady(tab);
  await tab.waitForLoadState("networkidle");
  expect(pathFetches).toEqual([]);
  expect(hydrationErrors).toEqual([]);

  // The page's own response, alone, renders the branch (not only the
  // data for it).
  const response = await cold.request.get(`/c/${id}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const rendered = html.match(RENDERED_ROW) ?? [];
  expect(rendered.length).toBeGreaterThanOrEqual(2);
  expect(html).toContain(QUESTION);

  // With the chat in IndexedDB now, a reload shows it at once and without
  // a flash: the server's rows, then the same rows from the cache.
  await expect
    .poll(() => tab.evaluate(hasPersistedCache), {
      message: "the query cache is in IndexedDB",
    })
    .toBe(true);
  await tab.reload();
  await expect(assistantMessages(tab).last()).toContainText(REPLY);
  await composerReady(tab);
  await tab.waitForLoadState("networkidle");
  expect(
    await tab.evaluate(
      () => (window as unknown as { __rowsDropped?: boolean }).__rowsDropped
    )
  ).toBeUndefined();
  expect(pathFetches).toEqual([]);
  expect(hydrationErrors).toEqual([]);

  // And the chat still works.
  await send(tab, "And once more");
  await expectReply(tab, "Echo: And once more");
  await expect(userMessages(tab)).toHaveCount(2);
  await cold.close();
});

test("a chat someone else can't read seeds nothing into the page", async ({
  baseURL,
  browser,
  page,
}) => {
  const secret = "Private seeded walrus";
  await page.goto("/");
  await send(page, secret);
  await expectReply(page, `Echo: ${secret}`);
  const id = await conversationIdOf(page);

  const ben = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ben"),
  });
  // The API's answer, unchanged: not found.
  const api = await apiFor(ben, baseURL ?? "");
  await expect(api.conversations.get({ id })).rejects.toMatchObject({
    status: 404,
  });

  // Nothing of it in the page's response, rendered or as data.
  const response = await ben.request.get(`/c/${id}`);
  const html = await response.text();
  expect(html).not.toContain(secret);
  expect(html.match(RENDERED_ROW)).toBeNull();

  const tab = await ben.newPage();
  await tab.goto(`/c/${id}`);
  await composerReady(tab);
  await expect(tab.getByText(secret)).toHaveCount(0);
  await expect(tab.locator("[data-message-id]")).toHaveCount(0);
  await ben.close();
});
