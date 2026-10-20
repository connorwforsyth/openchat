import { expect } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import {
  assistantMessages,
  conversationIdOf,
  expectReply,
  send,
  userMessages,
} from "../../../../e2e/support/chat";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";
import { chatRow } from "./handles";

// Feature: chat (features/chat.md). The reply comes from the mock model
// server, which echoes: no paid provider is reachable from this instance.

test.use({ storageState: authState("ada") });

test("a new chat streams a reply, gets a title, and survives a reload", async ({
  baseURL,
  page,
}) => {
  // A fresh word per run, so a reused instance never has two such chats.
  const tag = `c${Date.now().toString(36)}`;
  await page.goto("/");
  await expect(page.getByText("What can I help with?")).toBeVisible();
  await proof(page, "chat", "01-new-chat");

  await send(page, `Hello ${tag} alpha`);
  await expectReply(page, `Echo: Hello ${tag} alpha`);
  const id = await conversationIdOf(page);
  await proof(page, "chat", "02-first-reply");

  const title = `Topic Hello ${tag} alpha`;
  await expect(chatRow(page, title)).toBeVisible();

  await page.reload();
  await expect(userMessages(page)).toHaveCount(1);
  await expect(assistantMessages(page)).toHaveCount(1);
  await send(page, "And a second turn");
  await expectReply(page, "Echo: And a second turn");
  await expect(assistantMessages(page)).toHaveCount(2);

  // Side effect: the stored conversation, read back through the API.
  const api = await apiFor(page, baseURL ?? "");
  const stored = await api.conversations.get({ id });
  expect(stored.title).toBe(title);
  await proof(page, "chat", "03-after-reload-second-turn", {
    id,
    title: stored.title,
  });
});
