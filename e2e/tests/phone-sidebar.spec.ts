import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { apiFor } from "../support/api";
import { composerReady } from "../support/chat";
import { clickHydrated } from "../support/hydration";
import { storageStateFor } from "../support/users";

// The sidebar sheet on a phone (181): compact 40px rows with a 44px hit
// area, the row's status keeps its end (no ⋯ drawn over it), and a long
// press opens the row's actions.

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

test("rows are 40px with a 44px hit area and no ⋯ over the status", async ({
  page,
}) => {
  const box = await row(page).boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(40);
  expect(
    await row(page).evaluate((node) => {
      const after = getComputedStyle(node, "::after");
      return (
        node.getBoundingClientRect().height - 2 * Number.parseFloat(after.top)
      );
    })
  ).toBe(44);

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
