import { expect, test } from "@playwright/test";

import { apiFor, loadWorld } from "../support/api";
import { conversationIdOf, expectReply, send } from "../support/chat";
import { storageStateFor } from "../support/users";

// PLAN.md §11 M1 step 8: "remember I prefer pnpm" updates the memory file,
// shows the undo note, and Undo reverts it. Nothing is saved from a shared
// chat. Ben's memory file is empty when this starts.

test.use({ storageState: storageStateFor("ben") });

test("the agent remembers, the note offers Undo, and Undo reverts", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  const before = await api.memory.get();
  expect(before.content).toBe("");

  await page.goto("/");
  await send(page, "remember I prefer pnpm");
  const note = page.locator('[data-slot="memory-note"]');
  await expect(note).toContainText("Memory updated: Prefer pnpm");
  await expectReply(page, "Tool result:");
  await expect
    .poll(async () => (await api.memory.get()).content)
    .toContain("I prefer pnpm");

  await note.getByRole("button", { name: "Undo" }).click();
  await expect(note).toContainText("Memory change undone");
  await expect
    .poll(async () => (await api.memory.get()).content)
    .not.toContain("pnpm");
});

test("nothing is saved from a shared chat", async ({ baseURL, page }) => {
  const api = await apiFor(page, baseURL ?? "");
  const { orgId } = await loadWorld();
  const members = await api.orgs.members({ limit: 50, orgId });
  const ada = members.items.find((member) => member.user.name === "Ada Admin");
  if (!ada) {
    throw new Error("Ada isn't in Acme");
  }

  await page.goto("/");
  await send(page, "A chat I will share");
  await expectReply(page, "Echo: A chat I will share");
  const id = await conversationIdOf(page);
  await api.grants.create({
    permission: "editor",
    principal: { id: ada.user.id, type: "user" },
    resourceId: id,
    resourceType: "conversation",
  });

  const versions = (await api.memory.versions({})).items.length;
  await page.reload();
  await send(page, "remember I like tabs");
  // Without the memory tool the model just answers.
  await expectReply(page, "Echo: remember I like tabs");
  await expect(page.locator('[data-slot="memory-note"]')).toHaveCount(0);
  expect((await api.memory.get()).content).not.toContain("tabs");
  expect((await api.memory.versions({})).items).toHaveLength(versions);
});
