import { expect, type Page, test } from "@playwright/test";

import {
  chatHeader,
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { PALETTE_KEY } from "../support/keys";
import { storageStateFor } from "../support/users";

// ⌘K search as it's typed (ticket 100): the server matches the last word as
// a prefix, results never blink out between keystrokes, no empty "Chats"
// heading while a search runs, and Enter opens the top result. Ben's account:
// Ada's chats say "question" and "queue" elsewhere in the suite.

test.use({ storageState: storageStateFor("ben") });

interface Frame {
  readonly chat: boolean;
  readonly emptyGroups: number;
  readonly query: string;
}

/** Records, every animation frame, what the palette shows. */
const recordFrames = (page: Page, title: string) =>
  page.evaluate((wanted) => {
    const frames: Frame[] = [];
    (window as unknown as { __frames: Frame[] }).__frames = frames;
    const sample = () => {
      const groups = [...document.querySelectorAll("[cmdk-group]")];
      frames.push({
        chat: [...document.querySelectorAll("[cmdk-item]")].some((item) =>
          item.textContent?.includes(wanted)
        ),
        emptyGroups: groups.filter(
          (group) => group.querySelectorAll("[cmdk-item]").length === 0
        ).length,
        query:
          document.querySelector<HTMLInputElement>("[cmdk-input]")?.value ?? "",
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, title);

test("⌘K finds a chat from the first letters of a word in it; Enter opens it", async ({
  page,
}) => {
  // Its title is "Topic Trip notes today:", so only the server's full-text
  // search over the message can find "que…".
  await page.goto("/");
  await send(
    page,
    "Trip notes today: quetzal quetzal sightings, quetzal again"
  );
  await expectReply(page, "Echo: Trip notes today");
  const id = await conversationIdOf(page);
  const title = "Topic Trip notes today";
  // The title is written by a background job; search by it once it's there.
  await expect(chatHeader(page)).toContainText(title);

  await page.goto("/");
  await composerReady(page);
  await expect(composer(page)).toBeEditable();
  const search = page.getByPlaceholder("Search or type a command…");
  // The palette loads after boot (composer:ready on chat pages).
  await expect(async () => {
    await page.keyboard.press(PALETTE_KEY);
    await expect(search).toBeVisible({ timeout: 1000 });
  }).toPass();

  await recordFrames(page, title);
  await search.pressSequentially("que", { delay: 90 });
  const hit = page.getByRole("option", { name: title });
  await expect(hit).toBeVisible();
  // Typing on and back while the chat still matches: it never blinks out.
  await search.pressSequentially("tz", { delay: 90 });
  await expect(hit).toBeVisible();
  await search.press("Backspace");
  await search.press("Backspace");
  await expect(search).toHaveValue("que");
  await expect(hit).toBeVisible();
  // Let any search still in flight land before reading the frames.
  await page.waitForTimeout(500);

  const frames = await page.evaluate(
    () => (window as unknown as { __frames: Frame[] }).__frames
  );
  expect(frames.filter((frame) => frame.emptyGroups > 0)).toEqual([]);
  // Before typing, the palette lists recent chats, this one among them;
  // "q" alone is too short for the server, so the match starts later.
  const typed = frames.filter((frame) => frame.query.length > 0);
  const first = typed.findIndex((frame) => frame.chat);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(typed.slice(first).filter((frame) => !frame.chat)).toEqual([]);

  // The chat landed above "Ask AI" and is selected, so Enter opens it.
  await expect(hit).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/c/${id}`));
  await expectReply(page, "Echo: Trip notes today");
});
