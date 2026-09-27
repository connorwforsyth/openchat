import { expect, test } from "@playwright/test";

import { apiFor, eventually } from "../support/api";
import {
  assistantMessages,
  composer,
  conversationIdOf,
  expectReply,
  send,
  userMessages,
} from "../support/chat";
import { recordBootTimings } from "../support/timings";
import { CHAT_URL } from "../support/urls";
import { storageStateFor } from "../support/users";

// PLAN.md §11 M1 step 3 (chat with streaming, resume after reload, branch by
// editing, search) and step 10's title job, plus the D27 boot timings.

test.use({ storageState: storageStateFor("ada") });

test("a new chat streams a reply, gets a title, and records the boot timings", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await recordBootTimings(page, "/ (new chat)");
  await send(page, "Hello zebracorn alpha", {
    measure: { token: "Echo", where: "new chat" },
  });
  await expectReply(page, "Echo: Hello zebracorn alpha");
  const id = await conversationIdOf(page);
  await expect(userMessages(page)).toHaveCount(1);

  // Titles come from a background job on the cheap model (§11 step 10).
  const api = await apiFor(page, baseURL ?? "");
  const title = "Topic Hello zebracorn alpha";
  const titled = await eventually(
    () => api.conversations.get({ id }),
    (chat) => chat.title === title
  );
  expect(titled.title).toBe(title);

  // A second turn in the same chat, and the boot timings of a chat page.
  await page.reload();
  await recordBootTimings(page, "/c/[id] (reload)");
  await send(page, "And a second turn", {
    measure: { token: "Echo", where: "second turn" },
  });
  await expectReply(page, "Echo: And a second turn");
  await expect(assistantMessages(page)).toHaveCount(2);
  // The title isn't pushed to an open page: it shows once the chat list is
  // next fetched (a finished turn refreshes it; so does a load after the
  // 30 s the cached list counts as fresh).
  await expect(
    page.getByRole("complementary", { name: "Chats" }).getByText(title)
  ).toBeVisible();
});

test("closing the tab mid-reply and reopening resumes the stream", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await send(page, "[slow] please take your time");
  const id = await conversationIdOf(page);
  // Part of the reply is on screen, and the run is still going.
  await expect(assistantMessages(page).last()).toContainText("word3");
  await expect(assistantMessages(page).last()).not.toContainText("done.");
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto(`/c/${id}`);
  const reply = assistantMessages(reopened).last();
  // The words streamed before the close are there, and the rest arrives.
  await expect(reply).toContainText("word1");
  await expect(reply).toContainText("done.", { timeout: 30_000 });
  const words = Array.from({ length: 40 }, (_, index) => `word${index + 1}`);
  await expect(reply).toContainText(`Slow reply: ${words.join(" ")} done.`);
  // Once, not replayed on top of what was already there.
  expect((await reply.textContent())?.split("Slow reply:")).toHaveLength(2);
  await expect(assistantMessages(reopened)).toHaveCount(1);
});

test("editing a message starts a branch; the original stays reachable", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "Branch base question");
  await expectReply(page, "Echo: Branch base question");
  await conversationIdOf(page);

  const question = userMessages(page).first();
  await question.hover();
  await question.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Edit message" });
  await editor.fill("Branch edited question");
  await editor.press("Enter");
  await expectReply(page, "Echo: Branch edited question");
  await expect(userMessages(page).first()).toContainText(
    "Branch edited question"
  );

  // The branch switcher moves back to the original exchange.
  await userMessages(page).first().hover();
  await page.getByRole("button", { name: "Previous branch" }).first().click();
  await expect(userMessages(page).first()).toContainText(
    "Branch base question"
  );
  await expectReply(page, "Echo: Branch base question");
});

test("⌘K finds a chat by what was said in it", async ({ page }) => {
  await page.goto("/");
  await expect(composer(page)).toBeEditable();
  await page.keyboard.press("ControlOrMeta+K");
  const search = page.getByPlaceholder("Search or type a command…");
  await expect(search).toBeVisible();
  // A word from the first chat's message (not its title): server full text.
  await search.fill("zebracorn");
  const hit = page.getByRole("option", { name: "Topic Hello zebracorn alpha" });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(CHAT_URL);
  await expectReply(page, "Echo: And a second turn");
});
