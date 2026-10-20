import { expect } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import {
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../../../../e2e/support/chat";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";
import { chatRow, sidebar } from "./handles";

// Feature: sidebar (features/sidebar.md): a chat appears in the Chats list
// by title, keeps it across an immediate reload, opens from its row, and
// renames from the row menu.

test.use({ storageState: authState("ada") });

test("a chat lists in the sidebar, survives a reload, opens from it, and renames", async ({
  baseURL,
  page,
}) => {
  // A fresh word per run, so a reused instance never has two such rows.
  const tag = `s${Date.now().toString(36)}`;
  const renamed = `Renamed ${tag}`;
  const title = `Topic Sidebar ${tag} beta`;
  const row = chatRow(page, title);
  await page.goto("/");
  await send(page, `Sidebar ${tag} beta`);
  await expectReply(page, `Echo: Sidebar ${tag} beta`);
  await expect(row).toBeVisible();
  const id = await conversationIdOf(page);

  // No proof step before this reload: the screenshot's delay hid a
  // persisted-cache bug that only shows within a second of the title.
  await page.goto("/");
  await composerReady(page);
  await expect(
    row,
    "the row keeps its title across a reload right after it got one"
  ).toBeVisible();
  await proof(page, "sidebar", "01-listed-after-reload");

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  await expect(page.getByText(`Echo: Sidebar ${tag} beta`)).toBeVisible();
  await proof(page, "sidebar", "02-opened-from-row");

  await row.hover();
  await sidebar(page)
    .getByRole("button", { name: `Actions for ${title}` })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = sidebar(page).getByRole("textbox", { name: "Chat title" });
  await expect(input).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(renamed);
  await page.keyboard.press("Enter");
  await expect(chatRow(page, renamed)).toBeVisible();

  const api = await apiFor(page, baseURL ?? "");
  // The rename is optimistic (D28): the row changes before the server does.
  await expect
    .poll(async () => (await api.conversations.get({ id })).title)
    .toBe(renamed);
  await proof(page, "sidebar", "03-renamed", { id, title: renamed });
});
