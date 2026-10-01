import { expect, test } from "@playwright/test";

import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import {
  buttonNames,
  numberedLines,
  quickFooter,
  quickRoot,
  scrollbarsThatCouldShow,
  seeThrough,
  typeLines,
} from "../support/quick";
import { CHAT_URL, QUICK_URL, SIGN_IN_URL } from "../support/urls";
import { storageStateFor } from "../support/users";

// Quick AI's page (118): the composer alone, for the desktop app's floating
// window (e2e/desktop covers the window). In a browser it works the same:
// each send starts a new chat, ⏎ answers on the page, ⌘⏎ goes to the chat.
// 135: a strip, the input and Send alone, with no hints and no scrollbar;
// a reply comes with a footer naming ⌘⏎.

test.describe("signed in", () => {
  test.use({ storageState: storageStateFor("ada") });

  test("asks in a new chat and answers on the page", async ({ page }) => {
    await page.goto("/quick");
    // Only the composer: none of the app's chrome.
    await expect(page.locator('[data-slot="app-header"]')).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Chats" })
    ).toHaveCount(0);

    // Idle, a strip: the input and Send, and nothing under it.
    await composerReady(page);
    const root = quickRoot(page);
    await expect(
      composer(page).locator("[data-placeholder]").first()
    ).toHaveAttribute("data-placeholder", "Ask anything…");
    expect(await buttonNames(root)).toEqual(["Send"]);
    await expect(root.getByText("Ask here")).toHaveCount(0);
    await expect(root.locator("kbd")).toHaveCount(0);
    await expect(quickFooter(page)).toHaveCount(0);
    expect(await scrollbarsThatCouldShow(page)).toEqual([]);
    // In a browser there's no native material behind the page.
    expect(await seeThrough(page)).toBe(false);

    await send(page, "Quick ocelot question");
    const reply = page.locator('[data-slot="quick-reply"]');
    await expect(reply).toContainText("Echo: Quick ocelot question");
    await expect(page).toHaveURL(QUICK_URL);
    // The reply's footer names the action, and still no scrollbar.
    await expect(quickFooter(page)).toContainText("Quick ocelot question");
    expect(await scrollbarsThatCouldShow(page)).toEqual([]);

    // A real chat: opening it shows the same exchange in the app.
    await page.getByRole("button", { name: "Open in the app" }).click();
    await expect(page).toHaveURL(CHAT_URL);
    await expectReply(page, "Echo: Quick ocelot question");
  });

  test("a long question grows the strip to a cap, then scrolls hidden", async ({
    page,
  }) => {
    await page.goto("/quick");
    await composerReady(page);
    const input = composer(page);
    const oneLine = (await input.boundingBox())?.height ?? 0;
    await input.click();
    await typeLines(input, numberedLines("line", 12));
    const tall = (await input.boundingBox())?.height ?? 0;
    expect(tall).toBeGreaterThan(oneLine);
    // Capped: it scrolls rather than growing past about five lines.
    expect(tall).toBeLessThanOrEqual(176);
    expect(
      await input.evaluate((node) => node.scrollHeight > node.clientHeight)
    ).toBe(true);
    expect(await scrollbarsThatCouldShow(page)).toEqual([]);
  });

  test("a long reply scrolls inside a capped page, with no scrollbar", async ({
    page,
  }) => {
    await page.goto("/quick");
    await composerReady(page);
    const input = composer(page);
    await input.click();
    await typeLines(input, numberedLines("Long line", 30));
    await input.press("Enter");
    const reply = page.locator('[data-slot="quick-reply"]');
    await expect(reply).toContainText("Long line 30");
    // As tall as the Quick AI window gets, and no taller.
    expect(
      await quickRoot(page).evaluate(
        (root) => root.getBoundingClientRect().height
      )
    ).toBeLessThanOrEqual(560);
    expect(
      await reply.evaluate((node) => node.scrollHeight > node.clientHeight)
    ).toBe(true);
    await expect(quickFooter(page)).toBeInViewport();
    expect(await scrollbarsThatCouldShow(page)).toEqual([]);
  });

  test("⌘⏎ with nothing typed opens the reply's chat", async ({ page }) => {
    await page.goto("/quick");
    await send(page, "Quick reply to open");
    await expect(page.locator('[data-slot="quick-reply"]')).toContainText(
      "Echo: Quick reply to open"
    );
    await composer(page).press("ControlOrMeta+Enter");
    await expect(page).toHaveURL(CHAT_URL);
    await expectReply(page, "Echo: Quick reply to open");
  });

  test("⌘⏎ sends and opens the chat", async ({ page }) => {
    await page.goto("/quick");
    await composerReady(page);
    await composer(page).click();
    await composer(page).pressSequentially("Quick straight to the chat");
    await composer(page).press("ControlOrMeta+Enter");
    await expect(page).toHaveURL(CHAT_URL);
    await conversationIdOf(page);
    await expectReply(page, "Echo: Quick straight to the chat");
  });
});

test("signed out, /quick asks to sign in", async ({ page }) => {
  await page.goto("/quick");
  await expect(page).toHaveURL(SIGN_IN_URL);
});
