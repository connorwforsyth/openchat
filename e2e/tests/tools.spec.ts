import { expect, type Page, test } from "@playwright/test";

import { apiFor, eventually } from "../support/api";
import {
  assistantMessages,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { mockResults } from "../support/mock-search";
import { storageStateFor } from "../support/users";

// The harness gaps the audit found (078), as a person meets them in a plain
// model chat: the model searches the web over the configured backend and the
// answer cites it, it uses an MCP server nobody attached to an agent, and it
// makes an artifact and then a second version of it, each shown as a card
// that opens in the Workspace panel. The mock model calls whichever tool
// the message names (`[tool:<name> <json>]`), but only if the turn offers it.

test.use({ storageState: storageStateFor("ada") });

const APPROVE = /^Approve( all)?$/;
const SAVED_V1 = /Tool result: Saved "Trip plan" as version 1/;
const SAVED_V2 = /Tool result: Saved "Trip plan" as version 2/;
const UNKNOWN_TOOL_DONE = /Script unknown-tool done after 1 steps\./;

/** Approves the one call the run is waiting on. */
const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

test("a plain chat searches the web over the configured backend and cites what it found", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await send(page, '[tool:web_search {"query": "quokka habitats"}]');
  const [guide, notes] = mockResults("quokka habitats");
  // The results reached the model: the mock's reply repeats what it read.
  const reply = await expectReply(page, `Tool result: [1] ${guide.title}`);
  await expect(reply).toContainText(guide.content);
  await expect(reply.getByText("Searched the web")).toBeVisible();
  // And the answer cites them, as links.
  const sources = reply.getByRole("region", { name: "Sources" });
  await expect(
    sources.getByRole("link", { name: guide.title })
  ).toHaveAttribute("href", guide.url);
  await expect(sources.getByRole("link", { name: notes.title })).toBeVisible();

  // Stored, not just streamed: the call ran without asking, and the
  // citations are on the answer after a reload.
  const api = await apiFor(page, baseURL ?? "");
  const path = await api.messages.path({
    conversationId: await conversationIdOf(page),
  });
  const parts = path.messages.at(-1)?.parts ?? [];
  expect(parts.find((part) => part.type === "tool-call")).toMatchObject({
    approval: { state: "not-required" },
    toolName: "web_search",
  });
  expect(
    parts.flatMap((part) =>
      part.type === "source" && part.source.kind === "url"
        ? [part.source.url]
        : []
    )
  ).toEqual([guide.url, notes.url]);
  await page.reload();
  await expect(
    assistantMessages(page)
      .last()
      .getByRole("region", { name: "Sources" })
      .getByRole("link", { name: guide.title })
  ).toBeVisible();
});

test("web search stays out of a turn the composer turned it off for", async ({
  baseURL,
  page,
}) => {
  // The composer has no switch for it yet, so this turn goes through the
  // API, as the composer's would: with `webSearch: "off"` the tool isn't
  // offered, and the mock can only echo.
  await page.goto("/");
  await send(page, "A chat to continue");
  await expectReply(page, "Echo: A chat to continue");
  const api = await apiFor(page, baseURL ?? "");
  const conversationId = await conversationIdOf(page);
  const before = await api.messages.path({ conversationId });
  const started = await api.runs.create({
    conversationId,
    input: {
      parentId: before.messages.at(-1)?.id ?? null,
      parts: [{ text: '[tool:web_search {"query": "numbats"}]', type: "text" }],
      type: "message",
    },
    options: { webSearch: "off" },
  });
  const run = await eventually(
    () => api.runs.get({ id: started.runId }),
    (current) => current.state.status !== "running"
  );
  expect(run.state.status).toBe("succeeded");
  const after = await api.messages.path({ conversationId });
  const parts = after.messages.at(-1)?.parts ?? [];
  expect(parts.some((part) => part.type === "tool-call")).toBe(false);
  expect(
    parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
  ).toContain("Echo:");
});

test("a plain chat uses an MCP server without an agent that lists it, once the call is approved", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await send(page, '[tool:e2e__echo {"text": "hello from the mock server"}]');
  // Nobody picked this server for the chat, so the call asks first, and
  // nothing has run while it waits.
  const api = await apiFor(page, baseURL ?? "");
  const conversationId = await conversationIdOf(page);
  const card = page.locator(
    'section[aria-label="Approval needed for e2e__echo"]'
  );
  await expect(card).toBeVisible();
  const waiting = await api.messages.path({ conversationId });
  const pending = waiting.messages.at(-1)?.parts ?? [];
  expect(pending.find((part) => part.type === "tool-call")).toMatchObject({
    approval: { state: "pending" },
    toolName: "e2e__echo",
  });
  expect(pending.some((part) => part.type === "tool-result")).toBe(false);

  await approve(page, "e2e__echo");
  const reply = await expectReply(page, "hello from the mock server");
  await expect(reply).toContainText("Tool result:");
  await expect(reply.getByText("Used echo from e2e")).toBeVisible();

  const path = await api.messages.path({ conversationId });
  const parts = path.messages.at(-1)?.parts ?? [];
  expect(parts.find((part) => part.type === "tool-call")).toMatchObject({
    approval: { decision: { decision: "approve" }, state: "decided" },
    toolName: "e2e__echo",
  });
  expect(parts.find((part) => part.type === "tool-result")).toMatchObject({
    output: { status: "success" },
  });
});

test("the model makes an artifact, then a second version, each once approved", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await send(
    page,
    '[tool:create_artifact {"type": "markdown", "title": "Trip plan", "content": "Day one: the harbour."}]'
  );
  // Saving asks first; nothing exists until someone says yes.
  const api = await apiFor(page, baseURL ?? "");
  const conversationId = await conversationIdOf(page);
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_V1);

  // The answer carries a card for it, and the card opens the panel on it.
  const card = page.getByRole("button", { name: "Open artifact: Trip plan" });
  await expect(card).toHaveCount(1);
  await card.click();
  const panel = page.getByRole("region", { name: "Workspace" });
  await expect(panel.getByRole("heading", { name: "Trip plan" })).toBeVisible();
  await expect(panel.getByText("Day one: the harbour.")).toBeVisible();

  const [artifact] = await api.artifacts.list({ conversationId });
  expect(artifact).toMatchObject({ kind: "markdown", title: "Trip plan" });

  // The model updates it by the id its first call returned.
  await send(
    page,
    `[tool:update_artifact {"artifactId": "${artifact?.id}", "content": "Day one: the harbour. Day two: the hills."}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, SAVED_V2);
  const cards = page.getByRole("button", { name: "Open artifact: Trip plan" });
  await expect(cards).toHaveCount(2);
  await cards.last().click();
  await expect(
    panel.getByText("Day one: the harbour. Day two: the hills.")
  ).toBeVisible();

  // One artifact, two versions, each pointing at the answer that made it.
  // (The panel shows the pager only when its header has room — 075 — so the
  // versions are counted here rather than read off the header.)
  expect(await api.artifacts.list({ conversationId })).toHaveLength(1);
  const versions = await api.artifacts.listVersions({ id: artifact?.id ?? "" });
  expect(versions.map((version) => version.number)).toEqual([1, 2]);
  const path = await api.messages.path({ conversationId });
  const answers = path.messages.filter(
    (message) => message.role === "assistant"
  );
  expect(versions.map((version) => version.messageId)).toEqual(
    answers.map((answer) => answer.id)
  );
  // The cards are stored on the answers: a reload still shows both.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open artifact: Trip plan" })
  ).toHaveCount(2);
});

test("a call to a tool the chat doesn't have is an error the model reads, and it still answers (131)", async ({
  baseURL,
  page,
}) => {
  // The mock calls `frobnicate`, which no turn offers, then answers with
  // what it was told. The run doesn't fail: the call ends in an error.
  await page.goto("/");
  await send(page, "[script:unknown-tool]");
  const reply = await expectReply(page, UNKNOWN_TOOL_DONE);
  await expect(reply).toContainText("unavailable tool 'frobnicate'");
  await expect(reply.getByText("Couldn't use frobnicate")).toBeVisible();
  await expect(page.getByText("This answer stopped early.")).toHaveCount(0);

  // Stored as the call the model made, with its error, and shown the same
  // way after a reload.
  const api = await apiFor(page, baseURL ?? "");
  const conversationId = await conversationIdOf(page);
  const parts =
    (await api.messages.path({ conversationId })).messages.at(-1)?.parts ?? [];
  expect(parts.find((part) => part.type === "tool-call")).toMatchObject({
    input: { path: "notes.txt" },
    toolName: "frobnicate",
  });
  expect(parts.find((part) => part.type === "tool-result")).toMatchObject({
    output: { status: "error" },
    toolName: "frobnicate",
  });
  await page.reload();
  await expect(
    assistantMessages(page).last().getByText("Couldn't use frobnicate")
  ).toBeVisible();
});
