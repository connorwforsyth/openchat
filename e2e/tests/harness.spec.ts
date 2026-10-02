import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ApiClient } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { apiFor, eventually } from "../support/api";
import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  openWorkspace,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// The approval harness as a person meets it (072, from the audit in
// docs/audits/2026-09-30/audit-harness.md): every card the policy asks for
// appears live, a decision is sent once and stays made, Stop stops the run
// on the server, a reload shows where the run is, and a second tab follows
// the first. The mock plays scripted multi-step turns (`[script:<name>]`,
// support/mock-llm.ts); the workspace is just-bash, so nothing here needs
// Docker.

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("ada") });

const APPROVE = /^Approve( all)?$/;
const REJECT = /^Reject( all)?$/;
const STOPPED_BY_YOU = /Stopped by you/;
const STOPPED_BY_USER = /^Stopped by the user before it finished\./;
const STOPPED_EARLY = "This answer stopped early.";
const SITE_DONE = /Script site done/;
const WAITING_NOTE = /Waiting for your approval above/;
const TOOL_RESULT = /Tool result:/;
const EDIT2_DONE = /Script edit2 done/;
const BATCH_DONE = /Script site-batch done/;
const RUNNING_SLEEP_30 = /^Running sleep 30/;
const RUNNING_SLEEP_4 = /^Running sleep 4/;
const WOKE_UP = /woke-up/;
const NEVER_MIND = /Echo: never mind, leave it/;
const REWRITE_DONE = /Script rewrite done/;

/** Approval cards on screen, not counting one whose decision is on its way. */
const cards = (page: Page): Locator =>
  page.locator(
    'section[aria-label^="Approval needed"]:not([aria-busy="true"])'
  );

/** Counts every approval card that mounts, and every decision posted. */
const watch = async (page: Page) => {
  const posts: number[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().includes("/approvals")
    ) {
      posts.push(response.status());
    }
  });
  await page.addInitScript(() => {
    const seen = new WeakSet<Element>();
    const holder = window as unknown as { __cardMounts: number };
    holder.__cardMounts = 0;
    const scan = () => {
      for (const card of document.querySelectorAll(
        'section[aria-label^="Approval needed"]'
      )) {
        if (!seen.has(card)) {
          seen.add(card);
          holder.__cardMounts += 1;
        }
      }
    };
    const start = () =>
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    if (document.documentElement) {
      start();
    } else {
      document.addEventListener("DOMContentLoaded", start);
    }
  });
  return {
    mounts: () =>
      page.evaluate(
        () => (window as unknown as { __cardMounts: number }).__cardMounts
      ),
    posts,
  };
};

/** Approves the card on screen (there's one at a time in these scripts). */
const approveNext = async (page: Page) => {
  const card = cards(page).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

/** Every stored tool call on the branch, with its approval and result. */
const storedCalls = async (api: ApiClient, conversationId: ConversationId) => {
  const path = await api.messages.path({ conversationId });
  const results = new Map(
    path.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-result"
          ? [[part.toolCallId, part.output] as const]
          : []
      )
    )
  );
  return path.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool-call"
        ? [
            {
              approval: part.approval.state,
              result: results.get(part.toolCallId)?.status ?? null,
              tool: part.toolName,
            },
          ]
        : []
    )
  );
};

const runStatuses = async (api: ApiClient, conversationId: ConversationId) =>
  (await api.runs.list({ conversationId, limit: 20 })).items.map(
    (run) => run.state.status
  );

/** A new chat whose workspace exists, for scripts that need a file first. */
const chatWithWorkspace = async (page: Page, baseURL: string) => {
  await page.goto("/");
  await send(page, '[tool:bash {"command": "echo ready"}]');
  await expectReply(page, TOOL_RESULT);
  const id = await conversationIdOf(page);
  return { api: await apiFor(page, baseURL), id };
};

test("every card of a multi-file task appears live, without a reload", async ({
  baseURL,
  page,
}) => {
  const watched = await watch(page);
  await page.goto("/");
  await send(page, "[script:site]");
  // index.html, style.css, script.js: one write per step, then a preview.
  for (const _file of [1, 2, 3]) {
    // biome-ignore lint/performance/noAwaitInLoops: one card at a time, in order.
    await approveNext(page);
  }
  await expectReply(page, SITE_DONE);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText(STOPPED_EARLY)).toHaveCount(0);

  const api = await apiFor(page, baseURL ?? "");
  const id = await conversationIdOf(page);
  const writes = (await storedCalls(api, id)).filter((c) => c.tool === "write");
  expect(writes).toEqual(
    Array.from({ length: 3 }, () => ({
      approval: "decided",
      result: "success",
      tool: "write",
    }))
  );
  // One card and one decision per change the policy asks about.
  expect(await watched.mounts()).toBe(3);
  expect(watched.posts).toEqual([200, 200, 200]);
});

test("an edit sequence: each edit's card appears live", async ({
  baseURL,
  page,
}) => {
  const { api, id } = await chatWithWorkspace(page, baseURL ?? "");
  await api.sandbox.writeFile({
    content: "alpha\nbeta\nomega\n",
    conversationId: id,
    encoding: "utf8",
    path: "notes.txt",
  });
  await send(page, "[script:edit2]");
  await approveNext(page);
  await approveNext(page);
  await expectReply(page, EDIT2_DONE);
  const sandbox = await api.sandbox.get({ conversationId: id });
  const file = await api.sandbox.readFile({
    id: sandbox?.id ?? "",
    path: "notes.txt",
  });
  expect(JSON.stringify(file)).toContain("ALPHA");
  expect(JSON.stringify(file)).toContain("OMEGA");
});

test("rapid clicks on three changes in one step send each decision once", async ({
  baseURL,
  page,
}) => {
  const watched = await watch(page);
  await page.goto("/");
  await send(page, "[script:site-batch]");
  await expect(cards(page)).toHaveCount(3, { timeout: 30_000 });
  const buttons = await cards(page)
    .getByRole("button", { name: APPROVE })
    .all();
  // A double click on one, then the others as fast as they go. From the
  // last up: a card that's been decided drops its buttons, which would
  // shift the ones after it.
  await buttons[2]?.dblclick();
  await buttons[1]?.click();
  await buttons[0]?.click();
  await expectReply(page, BATCH_DONE);
  await expect(cards(page)).toHaveCount(0);

  expect(watched.posts).toEqual([200, 200, 200]);
  // No decided card came back with its buttons.
  expect(await watched.mounts()).toBe(3);
  const api = await apiFor(page, baseURL ?? "");
  const writes = (await storedCalls(api, await conversationIdOf(page))).filter(
    (c) => c.tool === "write"
  );
  expect(writes.map((c) => c.result)).toEqual([
    "success",
    "success",
    "success",
  ]);
});

test("reject all turns down each change and the agent carries on", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await send(page, "[script:site]");
  for (const _file of [1, 2, 3]) {
    const card = cards(page).first();
    // biome-ignore lint/performance/noAwaitInLoops: one card at a time, in order.
    await card.getByRole("button", { name: REJECT }).click();
    await card.getByRole("button", { exact: true, name: "Reject" }).click();
  }
  await expectReply(page, SITE_DONE);
  const api = await apiFor(page, baseURL ?? "");
  const writes = (await storedCalls(api, await conversationIdOf(page))).filter(
    (c) => c.tool === "write"
  );
  expect(writes.map((c) => c.result)).toEqual(["denied", "denied", "denied"]);
});

test("Stop while a change waits cancels the run, and the card goes everywhere", async ({
  baseURL,
  browser,
  page,
}) => {
  await page.goto("/");
  await send(page, "[script:one]");
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  const id = await conversationIdOf(page);
  const api = await apiFor(page, baseURL ?? "");

  // A second tab on the same chat drops the card too.
  const other = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const tab = await other.newPage();
  await tab.goto(`/c/${id}`);
  await expect(cards(tab)).toHaveCount(1, { timeout: 30_000 });

  // While a change waits the composer sends; Stop is in the note.
  const note = page.getByRole("status").filter({ hasText: WAITING_NOTE });
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "Stop" }).click();

  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText(STOPPED_BY_YOU)).toBeVisible();
  await expect(page.getByText(WAITING_NOTE)).toHaveCount(0);
  await expect(cards(tab)).toHaveCount(0);
  await expect(tab.getByText(STOPPED_BY_YOU)).toBeVisible();
  await eventually(
    () => runStatuses(api, id),
    (statuses) => statuses[0] === "cancelled"
  );
  expect(await storedCalls(api, id)).toEqual([
    { approval: "pending", result: "error", tool: "write" },
  ]);

  await page.reload();
  // Clicks before the page has hydrated do nothing.
  await composerReady(page);
  await expect(page.getByText(STOPPED_BY_YOU)).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await other.close();
});

/**
 * Holds API requests (batched ones included) whose url, decoded, matches,
 * until `release`: a slow connection, made deterministic.
 */
const holdApi = async (page: Page, matches: RegExp) => {
  const held: (() => void)[] = [];
  let holding = true;
  await page.route("**/api/**", async (route) => {
    if (holding && matches.test(decodeURIComponent(route.request().url()))) {
      await new Promise<void>((resolve) => {
        held.push(resolve);
      });
    }
    await route.fallback();
  });
  return {
    held: () => held.length,
    release: () => {
      holding = false;
      for (const each of held.splice(0)) {
        each();
      }
    },
  };
};

/** A decision on its way to the server. */
const DECIDING = /\/approvals$/;

/** The runs list a page asks when it looks for a run's stream to follow. */
const FINDING_THE_STREAM = /\/runs\?[^"]*limit=1(?!\d)/;

test("a second tab still looking for the stream when Stop lands drops the card too (136)", async ({
  baseURL,
  browser,
  page,
}) => {
  await page.goto("/");
  await send(page, "[script:one]");
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  const id = await conversationIdOf(page);
  const api = await apiFor(page, baseURL ?? "");

  // The other tab shows the stored card, but its look for the run's stream
  // is slow: by the time it's answered, the run has stopped.
  const other = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const tab = await other.newPage();
  const finding = await holdApi(tab, FINDING_THE_STREAM);
  await tab.goto(`/c/${id}`);
  await expect(cards(tab)).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(finding.held).toBeGreaterThan(0);

  const note = page.getByRole("status").filter({ hasText: WAITING_NOTE });
  await note.getByRole("button", { name: "Stop" }).click();
  await eventually(
    () => runStatuses(api, id),
    (statuses) => statuses[0] === "cancelled"
  );
  finding.release();
  await expect(cards(tab)).toHaveCount(0);
  await expect(tab.getByText(STOPPED_BY_YOU)).toBeVisible();
  await other.close();
});

test("Stop during a running command kills it and keeps the line", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await send(page, '[tool:bash {"command": "sleep 30; echo woke-late"}]');
  await expect(
    page.getByRole("button", { name: RUNNING_SLEEP_30 })
  ).toBeVisible({ timeout: 30_000 });
  const id = await conversationIdOf(page);
  const api = await apiFor(page, baseURL ?? "");
  const stoppedAt = Date.now();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect(page.getByText(STOPPED_BY_YOU)).toBeVisible();
  await eventually(
    () => runStatuses(api, id),
    (statuses) => statuses[0] === "cancelled",
    { timeoutMs: 10_000 }
  );
  // Killed, not waited out.
  expect(Date.now() - stoppedAt).toBeLessThan(15_000);
  expect(await storedCalls(api, id)).toEqual([
    { approval: "not-required", result: "error", tool: "bash" },
  ]);
  // What it printed before the kill, never the line after the sleep.
  const path = await api.messages.path({ conversationId: id });
  const stopped = path.messages
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool-result");
  expect(
    stopped?.type === "tool-result" && stopped.output.status === "error"
      ? stopped.output.message
      : ""
  ).toMatch(STOPPED_BY_USER);
  expect(JSON.stringify(stopped)).not.toContain("woke-late");
});

test("a reload mid-run or during a pause shows where the run is", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "[script:site]");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/approvals")),
    approveNext(page),
  ]);
  // Reload the moment the decision lands: the next card still comes.
  await page.reload();
  // Clicks before the page has hydrated do nothing.
  await composerReady(page);
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(STOPPED_EARLY)).toHaveCount(0);
  // And during the pause itself.
  await page.reload();
  // Clicks before the page has hydrated do nothing.
  await composerReady(page);
  await approveNext(page);
  await approveNext(page);
  await expectReply(page, SITE_DONE);

  // A reload while a command runs shows it running, then its result.
  await send(page, '[tool:bash {"command": "sleep 4; echo woke-up"}]');
  await expect(page.getByRole("button", { name: RUNNING_SLEEP_4 })).toBeVisible(
    { timeout: 30_000 }
  );
  await page.reload();
  // Clicks before the page has hydrated do nothing.
  await composerReady(page);
  await expect(page.getByText(STOPPED_EARLY)).toHaveCount(0);
  await expectReply(page, WOKE_UP);
});

/**
 * From the next load on, every event of a run's stream reaches the page
 * `ms` after the one before: a slow connection replaying a long answer.
 * `window.__lastStreamEvent` says when the last one arrived.
 */
const slowStreams = (page: Page, ms: number) =>
  page.addInitScript((delay) => {
    const holder = window as unknown as { __lastStreamEvent?: number };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (!(url.includes("/api/runs/") && url.includes("/stream"))) {
        return response;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        return response;
      }
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      const body = new ReadableStream<Uint8Array>({
        cancel: () => reader.cancel(),
        pull: async (sink) => {
          for (;;) {
            const end = buffer.indexOf("\n\n");
            if (end !== -1) {
              const event = buffer.slice(0, end + 2);
              buffer = buffer.slice(end + 2);
              // biome-ignore lint/performance/noAwaitInLoops: one event at a time, in order, on purpose.
              await new Promise((resolve) => setTimeout(resolve, delay));
              sink.enqueue(encoder.encode(event));
              holder.__lastStreamEvent = Date.now();
              return;
            }
            const { done, value } = await reader.read();
            if (done) {
              sink.close();
              return;
            }
            buffer += decoder.decode(value, { stream: true });
          }
        },
      });
      return new Response(body, {
        headers: response.headers,
        status: response.status,
      });
    };
  }, ms);

/** Resolves once no stream event has arrived for a second. */
const streamQuiet = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const last = (window as unknown as { __lastStreamEvent?: number })
            .__lastStreamEvent;
          return last === undefined ? 0 : Date.now() - last;
        }),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(1000);

test("a decision sent while a reloaded page replays the run stays sent (136)", async ({
  page,
}) => {
  const watched = await watch(page);
  await page.goto("/");
  await send(page, "[script:site]");
  await approveNext(page);
  await expect(
    page.getByRole("button", { name: "Wants to change style.css" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(cards(page)).toHaveCount(1);

  // Reloaded during the pause on a slow connection: the page picks the run
  // up and replays it from the start, slowly. The card shows at once, from
  // the stored answer, and is approved while the replay is still going,
  // with the decision slow to land too.
  await slowStreams(page, 100);
  await page.reload();
  await composerReady(page);
  const deciding = await holdApi(page, DECIDING);
  await approveNext(page);
  await streamQuiet(page);
  // The replay caught up: the decision is still on its way, and the card
  // never came back undecided.
  await expect(cards(page)).toHaveCount(0);
  deciding.release();
  await expect(
    page.getByRole("button", { name: "Wants to change script.js" })
  ).toBeVisible({ timeout: 30_000 });
  await approveNext(page);
  await expectReply(page, SITE_DONE);
  await expect(cards(page)).toHaveCount(0);
  // One decision per card: index.html, style.css, script.js.
  expect(watched.posts).toEqual([200, 200, 200]);
});

/** The chat's stored branch, fetched (batched or not). */
const STORED_BRANCH = /\/conversations\/[0-9a-f-]+\/path(?=["?&]|$)/;

/**
 * The persisted query cache (D28) as text: idb-keyval's default store,
 * where `query-persistence.ts` keeps it.
 */
const persistedCache = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => resolve("");
        open.onsuccess = () => {
          try {
            const read = open.result
              .transaction("keyval")
              .objectStore("keyval")
              .get("query-cache");
            read.onsuccess = () => resolve(JSON.stringify(read.result ?? ""));
            read.onerror = () => resolve("");
          } catch {
            resolve("");
          }
        };
      })
  );

test("a card restored from the last visit waits until it's checked (136)", async ({
  page,
}) => {
  const watched = await watch(page);
  await page.goto("/");
  await send(page, "[script:site]");
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  // The index.html card is in the cache kept for the next visit.
  await expect
    .poll(async () => (await persistedCache(page)).includes("pending"), {
      timeout: 15_000,
    })
    .toBe(true);

  // On a slow connection the branch doesn't refetch after the decision,
  // so the kept copy still shows index.html waiting.
  const checking = await holdApi(page, STORED_BRANCH);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/approvals")),
    approveNext(page),
  ]);
  await page.reload();
  await composerReady(page);
  // The restored card shows, but can't be decided until the branch is
  // checked: it was decided already.
  await expect(
    page.locator('section[aria-label^="Approval needed"]')
  ).not.toHaveCount(0);
  await expect(cards(page)).toHaveCount(0);
  checking.release();
  await expect(
    page.getByRole("button", { name: "Wants to change style.css" })
  ).toBeVisible({ timeout: 30_000 });
  await approveNext(page);
  await expect(
    page.getByRole("button", { name: "Wants to change script.js" })
  ).toBeVisible({ timeout: 30_000 });
  await approveNext(page);
  await expectReply(page, SITE_DONE);
  expect(watched.posts).toEqual([200, 200, 200]);
});

test("two tabs: a decision in one shows in the other, and deciding twice is harmless", async ({
  baseURL,
  browser,
  page,
}) => {
  await page.goto("/");
  await send(page, "[script:site]");
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  const id = await conversationIdOf(page);

  const other = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const tab = await other.newPage();
  const tabWatch = await watch(tab);
  await tab.goto(`/c/${id}`);
  await expect(cards(tab)).toHaveCount(1, { timeout: 30_000 });

  // The other tab approves index.html; this one moves on to style.css.
  await approveNext(tab);
  await expect(
    page.getByRole("button", { name: "Wants to change style.css" })
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  // This tab approves style.css; the other moves on to script.js.
  await approveNext(page);
  await expect(
    tab.getByRole("button", { name: "Wants to change script.js" })
  ).toBeVisible();
  // Both approve script.js at once: the same decision twice is a no-op.
  // The second click may find the card already gone (the first decision
  // reached that tab first), which is fine too.
  const mine = cards(page).first().getByRole("button", { name: APPROVE });
  const theirs = cards(tab).first().getByRole("button", { name: APPROVE });
  await expect(mine).toBeVisible();
  await expect(theirs).toBeVisible();
  await Promise.all([
    mine.click(),
    theirs.click({ timeout: 5000 }).catch(() => undefined),
  ]);
  await expectReply(page, SITE_DONE);
  await expect(
    tab.locator(".is-assistant[data-message-id]").last()
  ).toContainText(SITE_DONE);
  expect(tabWatch.posts.every((status) => status === 200)).toBe(true);
  await other.close();
});

test("a new message while a change waits skips the change", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await send(page, "[script:one]");
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });
  const id = await conversationIdOf(page);
  const api = await apiFor(page, baseURL ?? "");

  await composerReady(page);
  await composer(page).click();
  await composer(page).pressSequentially("never mind, leave it");
  await page.keyboard.press("Enter");
  await expectReply(page, NEVER_MIND);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText(STOPPED_BY_YOU)).toBeVisible();
  await expect(page.getByText(WAITING_NOTE)).toHaveCount(0);
  const statuses = await runStatuses(api, id);
  expect(statuses).toEqual(["succeeded", "cancelled"]);
  const sandbox = await api.sandbox.get({ conversationId: id });
  const files = sandbox
    ? await api.sandbox.listFiles({ id: sandbox.id, path: "." })
    : [];
  expect(JSON.stringify(files)).not.toContain("probe.txt");
});

test("a change whose file is edited meanwhile says so, and can be asked for again", async ({
  baseURL,
  page,
}) => {
  const { api, id } = await chatWithWorkspace(page, baseURL ?? "");
  await api.sandbox.writeFile({
    content: "original\n",
    conversationId: id,
    encoding: "utf8",
    path: "doc.txt",
  });
  await send(page, "[script:rewrite]");
  await expect(cards(page)).toHaveCount(1, { timeout: 30_000 });

  // The person edits the file in the Files panel while the change waits.
  const panel = await openWorkspace(page);
  await panel.getByRole("treeitem", { name: "doc.txt" }).click();
  const editor = page.locator(
    '[data-slot="code-editor"] [contenteditable="true"]'
  );
  await expect(editor).toContainText("original");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("edited by hand");
  // A save that lands says nothing (077), so wait for the file itself.
  const box = await api.sandbox.get({ conversationId: id });
  await expect
    .poll(
      async () =>
        (await api.sandbox.readFile({ id: box?.id ?? "", path: "doc.txt" }))
          .content
    )
    .toContain("edited by hand");

  const card = cards(page).first();
  await expect(card.getByRole("alert")).toContainText(
    "changed after the agent proposed this"
  );
  await expect(card.getByRole("button", { name: APPROVE })).toHaveCount(0);
  await card.getByRole("button", { name: "Ask for an updated change" }).click();
  // The agent reads the file again and proposes the change afresh.
  await approveNext(page);
  await expectReply(page, REWRITE_DONE);
  const sandbox = await api.sandbox.get({ conversationId: id });
  const file = await api.sandbox.readFile({
    id: sandbox?.id ?? "",
    path: "doc.txt",
  });
  expect(file.content).toContain("agent version after re-read");
});
