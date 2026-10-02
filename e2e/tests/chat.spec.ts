import { expect, type Page, test } from "@playwright/test";

import { apiFor } from "../support/api";
import {
  assistantMessages,
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
  sendButton,
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

  // Titles come from a background job on the cheap model (§11 step 10),
  // and show up on the open page, in the sidebar and the header, without
  // a reload (044).
  const title = "Topic Hello zebracorn alpha";
  await expect(
    page.getByRole("complementary", { name: "Chats" }).getByText(title)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Rename chat: ${title}` })
  ).toBeVisible();
  const api = await apiFor(page, baseURL ?? "");
  expect((await api.conversations.get({ id })).title).toBe(title);

  // A second turn in the same chat, and the boot timings of a chat page.
  await page.reload();
  await recordBootTimings(page, "/c/[id] (reload)");
  await send(page, "And a second turn", {
    measure: { token: "Echo", where: "second turn" },
  });
  await expectReply(page, "Echo: And a second turn");
  await expect(assistantMessages(page)).toHaveCount(2);
});

/**
 * Where the composer's middle sits down the conversation column, 0 at its
 * top and 1 at its bottom, and how far its bottom is from the column's.
 */
const composerPosition = async (page: Page) => {
  const column = await page.locator("main").boundingBox();
  const frame = await page.locator('[data-slot="composer"]').boundingBox();
  if (!(column && frame)) {
    throw new Error("no composer or column on screen");
  }
  return {
    gapBelow: column.y + column.height - (frame.y + frame.height),
    middle: (frame.y + frame.height / 2 - column.y) / column.height,
  };
};

// 098: a new chat's composer sits in the middle (a little above it); the
// first send moves it to the bottom, and a started chat renders it there
// from the server on.
test("the composer is centred on a new chat and docks at the bottom once it starts", async ({
  page,
}) => {
  const html = await (await page.request.get("/")).text();
  expect(html).toContain('data-placement="center"');
  await page.goto("/");
  await composerReady(page);
  const centred = await composerPosition(page);
  expect(centred.middle).toBeGreaterThan(0.35);
  expect(centred.middle).toBeLessThan(0.55);
  await expect(page.getByText("What can I help with?")).toBeVisible();

  await send(page, "Hello from the middle");
  await expect
    .poll(async () => (await composerPosition(page)).gapBelow)
    .toBeLessThan(40);
  // The composer kept focus through the move.
  await expect(composer(page)).toBeFocused();
  await expectReply(page, "Echo: Hello from the middle");
  await expect(page.getByText("What can I help with?")).toHaveCount(0);
  const id = await conversationIdOf(page);

  // Reloaded, it's at the bottom in the server's HTML, so the first paint
  // never shows it centred.
  const reloaded = await (await page.request.get(`/c/${id}`)).text();
  expect(reloaded).toContain('data-placement="bottom"');
  expect(reloaded).not.toContain('data-placement="center"');
  await page.reload();
  expect((await composerPosition(page)).gapBelow).toBeLessThan(40);
  await expect(assistantMessages(page)).toHaveCount(1);
  expect((await composerPosition(page)).gapBelow).toBeLessThan(40);
});

/** Holds `method` requests to paths that `matches` from now on, until `release`. */
const holdRequests = async (
  page: Page,
  matches: (url: URL) => boolean,
  method: string
) => {
  const held: (() => void)[] = [];
  let holding = true;
  await page.route(matches, async (route) => {
    if (holding && route.request().method() === method) {
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

test("a message sent while a new chat is being made waits in the composer; the first still goes (134)", async ({
  page,
}) => {
  const creates: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/conversations"
    ) {
      creates.push(request.url());
    }
  });
  await page.goto("/");
  await composerReady(page);
  const creating = await holdRequests(
    page,
    (url) => url.pathname === "/api/conversations",
    "POST"
  );
  // The new chat's address: the router fetches its page before moving.
  const routing = await holdRequests(
    page,
    (url) => url.pathname.startsWith("/c/"),
    "GET"
  );
  const stop = page.getByRole("button", { exact: true, name: "Stop" });
  const second = "Second while it was made";
  const tryToSend = async () => {
    await composer(page).click();
    await composer(page).press("Enter");
    // Busy, as once a run starts: the message stays in the composer.
    await expect(stop).toBeVisible();
    await expect(composer(page)).toHaveText(second);
  };

  await send(page, "First of a new chat");
  await expect.poll(creating.held).toBe(1);
  // While the chat is created…
  await composer(page).pressSequentially(second);
  await tryToSend();
  creating.release();
  // …and while the page moves to its address.
  await expect.poll(routing.held).toBeGreaterThan(0);
  await tryToSend();
  routing.release();

  await expectReply(page, "Echo: First of a new chat");
  await conversationIdOf(page);
  await expect(composer(page)).toHaveText(second);
  await expect(sendButton(page)).toBeEnabled();
  await composer(page).press("Enter");
  await expectReply(page, `Echo: ${second}`);
  await expect(userMessages(page)).toHaveCount(2);
  await expect(userMessages(page).first()).toContainText("First of a new chat");
  await expect(userMessages(page).last()).toContainText(second);
  // One chat: the second message never made one of its own.
  expect(creates).toHaveLength(1);
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
