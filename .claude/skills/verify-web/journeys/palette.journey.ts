import { expect, type Page } from "@playwright/test";
import {
  chatHeader,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../../../../e2e/support/chat";
import { SETTINGS_URL } from "../../../../e2e/support/urls";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";
import { settings, sidebar } from "./handles";

// Feature: command palette (features/palette.md): it finds a chat by a word
// in it and runs an action (Open settings, which closes back to the chat).
// The first test opens it from the panel's Search chats button; the second
// holds ⌘K to its own entry point.

test.use({ storageState: authState("ada") });

const searchBox = (page: Page) =>
  page.getByPlaceholder("Search or type a command…");

const openFromPanel = async (page: Page) => {
  await sidebar(page)
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Search chats" })
    .click();
  await expect(searchBox(page)).toBeVisible();
};

test("Search chats finds a chat by its message text and opens settings", async ({
  page,
}) => {
  // A fresh word per run, so a reused instance never has two matches.
  const tag = `p${Date.now().toString(36)}`;
  await page.goto("/");
  await send(page, `Palette ${tag} quetzal sightings`);
  await expectReply(page, `Echo: Palette ${tag}`);
  const id = await conversationIdOf(page);
  // The mock titles a chat "Topic " + its first three words.
  const title = `Topic Palette ${tag} quetzal`;
  await expect(chatHeader(page)).toContainText(title);

  await page.goto("/");
  await composerReady(page);
  await openFromPanel(page);
  await searchBox(page).pressSequentially(tag, { delay: 60 });
  const hit = page.getByRole("option", { name: title });
  await expect(hit).toBeVisible();
  await proof(page, "palette", "01-search-hit");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  await proof(page, "palette", "02-opened-chat", { id });

  await openFromPanel(page);
  await searchBox(page).fill("settings");
  await page.getByRole("option", { name: "Open settings" }).click();
  await expect(page).toHaveURL(SETTINGS_URL);
  await expect(settings(page)).toBeVisible();
  await proof(page, "palette", "03-action-open-settings");
  await page.keyboard.press("Escape");
  await expect(settings(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
});

test("one ⌘K on a chat screen opens the palette and it stays open", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  // The palette loads after the composer is ready; once the network is idle
  // its shortcut is bound, as it is for a person who has just arrived.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("ControlOrMeta+K");
  await expect(searchBox(page)).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(
    searchBox(page),
    "still open a second after one press"
  ).toBeVisible({ timeout: 1 });
  await proof(page, "palette", "04-shortcut-open");
});
