import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { apiFor } from "../support/api";
import { composerReady } from "../support/chat";
import { clickHydrated } from "../support/hydration";
import { storageStateFor } from "../support/users";

// The sidebar sheet on a phone (181): rows drawn 36px tall that a finger
// hits across 40px, the row's status keeps its end (no ⋯ drawn over it),
// and a long press opens the row's actions.

test.use({
  hasTouch: true,
  isMobile: true,
  storageState: storageStateFor("ada"),
  viewport: { height: 844, width: 390 },
});

const TITLE = "Phone sidebar spec";

const sheet = (page: Page): Locator =>
  page.locator('[data-slot="app-shell-sidebar-sheet"]');
const row = (page: Page): Locator =>
  sheet(page).getByRole("button", { exact: true, name: TITLE });

/**
 * How tall `target` is drawn (its padding box) and how many pixel rows,
 * down a line through its middle, the browser hit-tests to it.
 */
const reach = (target: Locator) =>
  target.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2;
    let hit = 0;
    for (let y = Math.floor(box.top) - 4; y < box.bottom + 4; y += 1) {
      if (node.contains(document.elementFromPoint(x, y + 0.5))) {
        hit += 1;
      }
    }
    return { drawn: node.clientHeight, hit };
  });

let created: ConversationId | null = null;

test.beforeEach(async ({ baseURL, page }) => {
  const api = await apiFor(page, baseURL ?? "");
  const chat = await api.conversations.create({ title: TITLE });
  created = chat.id;
  await page.goto("/");
  await composerReady(page);
  await clickHydrated(
    page.getByRole("button", { name: "Toggle sidebar" }).first()
  );
  await expect(row(page)).toBeVisible();
});

test.afterEach(async ({ baseURL, page }) => {
  if (created) {
    const api = await apiFor(page, baseURL ?? "");
    await api.conversations.update({ archived: true, id: created });
  }
});

test("rows draw 36px, take 40px of touch, and no ⋯ over the status", async ({
  page,
}) => {
  const reaches = await Promise.all(
    [row(page), sheet(page).getByRole("button", { name: "New chat" })].map(
      reach
    )
  );
  for (const { drawn, hit } of reaches) {
    expect(drawn).toBe(36);
    expect(hit).toBeGreaterThanOrEqual(40);
  }

  const actions = sheet(page).getByRole("button", {
    name: `Actions for ${TITLE}`,
  });
  expect(
    await actions.evaluate((node) => {
      const style = getComputedStyle(node);
      return { events: style.pointerEvents, opacity: style.opacity };
    })
  ).toEqual({ events: "none", opacity: "0" });
});

test("a long press opens the row's actions", async ({ page }) => {
  const target = row(page);
  await target.dispatchEvent("pointerdown", {
    clientX: 20,
    clientY: 20,
    pointerType: "touch",
  });
  await page.waitForTimeout(700);
  await target.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
});

test("an archived row's Unarchive takes 40px of touch", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  await api.conversations.update({
    archived: true,
    id: created as ConversationId,
  });
  await clickHydrated(
    sheet(page).getByRole("button", { name: "Archived chats" })
  );
  const unarchive = sheet(page).getByRole("button", {
    name: `Unarchive ${TITLE}`,
  });
  await expect(unarchive).toBeVisible();
  expect((await reach(unarchive)).hit).toBeGreaterThanOrEqual(40);
});
