import { expect, test } from "@playwright/test";

import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { CHAT_URL, QUICK_URL, SIGN_IN_URL } from "../support/urls";
import { storageStateFor } from "../support/users";

// Quick AI's page (118): the composer alone, for the desktop app's floating
// window (e2e/desktop covers the window). In a browser it works the same:
// each send starts a new chat, ⏎ answers on the page, ⌘⏎ goes to the chat.

test.describe("signed in", () => {
  test.use({ storageState: storageStateFor("ada") });

  test("asks in a new chat and answers on the page", async ({ page }) => {
    await page.goto("/quick");
    // Only the composer: none of the app's chrome.
    await expect(page.locator('[data-slot="app-header"]')).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Chats" })
    ).toHaveCount(0);

    await send(page, "Quick ocelot question");
    const reply = page.locator('[data-slot="quick-reply"]');
    await expect(reply).toContainText("Echo: Quick ocelot question");
    await expect(page).toHaveURL(QUICK_URL);

    // A real chat: opening it shows the same exchange in the app.
    await page.getByRole("button", { name: "Open in the app" }).click();
    await expect(page).toHaveURL(CHAT_URL);
    await expectReply(page, "Echo: Quick ocelot question");
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
