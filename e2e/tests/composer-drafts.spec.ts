import { expect, test } from "@playwright/test";

import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Ticket 147: a chat's unsent draft survives a reload and switching chats,
// and ArrowUp in an empty composer brings back the last prompt.

test.use({ storageState: storageStateFor("ada") });

test("a draft survives a reload and switching chats, and is gone once sent", async ({
  page,
}) => {
  // The new-chat composer keeps its own draft.
  await page.goto("/");
  await composerReady(page);
  await composer(page).click();
  await composer(page).pressSequentially("An unsent new-chat thought");
  await page.reload();
  await composerReady(page);
  await expect(composer(page)).toHaveText("An unsent new-chat thought");

  // Sending makes the chat and forgets the new-chat draft.
  await composer(page).press("Enter");
  await expectReply(page, "Echo: An unsent new-chat thought");
  const id = await conversationIdOf(page);
  await expect(composer(page)).toHaveText("");

  // A draft in the chat, kept across a reload...
  await composer(page).click();
  await composer(page).pressSequentially("Draft for this chat");
  await page.reload();
  await composerReady(page);
  await expect(composer(page)).toHaveText("Draft for this chat");

  // ...and across a trip to a new chat, whose composer is empty.
  await page.goto("/");
  await composerReady(page);
  await expect(composer(page)).toHaveText("");
  await page.goto(`/c/${id}`);
  await composerReady(page);
  await expect(composer(page)).toHaveText("Draft for this chat");

  // Sent, it's gone.
  await composer(page).press("Enter");
  await expectReply(page, "Echo: Draft for this chat");
  await page.reload();
  await composerReady(page);
  await expect(composer(page)).toHaveText("");
});

test("ArrowUp in an empty composer recalls the prompts sent on the branch", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "The first prompt");
  await expectReply(page, "Echo: The first prompt");
  await send(page, "The second prompt");
  await expectReply(page, "Echo: The second prompt");

  const input = composer(page);
  await input.click();
  await input.press("ArrowUp");
  await expect(input).toHaveText("The second prompt");
  await input.press("ArrowUp");
  await expect(input).toHaveText("The first prompt");
  await input.press("ArrowDown");
  await expect(input).toHaveText("The second prompt");
  await input.press("ArrowDown");
  await expect(input).toHaveText("");
});
