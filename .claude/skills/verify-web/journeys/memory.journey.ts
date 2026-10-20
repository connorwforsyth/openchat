import { expect } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import { expectReply, send } from "../../../../e2e/support/chat";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";
import { settings } from "./handles";

// Feature: memory (features/memory.md): "remember …" makes the mock model
// call update_memory; the note offers Undo; Settings › Memory shows it in
// the full-screen settings view.

test.use({ storageState: authState("ada") });

const PNPM = /I prefer pnpm/;

test("remember saves to memory, shows in settings, and Undo reverts", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  expect((await api.memory.get()).content).toBe("");

  await page.goto("/");
  await send(page, "remember I prefer pnpm");
  const note = page.locator('[data-slot="memory-note"]');
  await expect(note).toContainText("Memory updated: Prefer pnpm");
  await expectReply(page, "Tool result:");
  await expect
    .poll(async () => (await api.memory.get()).content)
    .toContain("I prefer pnpm");
  await proof(page, "memory", "01-memory-updated", await api.memory.get());

  const chat = page.url();
  await page.goto("/settings/memory");
  await expect(
    settings(page).getByRole("textbox", { name: "Memory" })
  ).toHaveValue(PNPM);
  await proof(page, "memory", "02-settings-memory");

  await page.goto(chat);
  await note.getByRole("button", { name: "Undo" }).click();
  await expect(note).toContainText("Memory change undone");
  await expect
    .poll(async () => (await api.memory.get()).content)
    .not.toContain("pnpm");
  await proof(page, "memory", "03-undone", await api.memory.get());
});
