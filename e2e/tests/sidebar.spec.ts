import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { apiFor } from "../support/api";
import { composerReady } from "../support/chat";
import { clickHydrated, hydrated } from "../support/hydration";
import { storageStateFor } from "../support/users";

// The sidebar's feel (071): ChatGPT-like rows, a drag-resizable edge whose
// width survives a reload without a jump, collapse and the edge peek, the
// 480px conversation rule, the narrow-screen drawer, and rename after other
// rows' menus were opened and closed (the audit's bug).

test.use({ storageState: storageStateFor("ada") });

const LONG_TITLE =
  "Sidebar spec: a very long chat title that cannot possibly fit in the row";
const SHORT_TITLE = "Sidebar spec: short";

const sidebar = (page: Page): Locator =>
  page.getByRole("complementary", { name: "Chats" });
const row = (page: Page, title: string): Locator =>
  sidebar(page).getByRole("button", { exact: true, name: title });
const handle = (page: Page): Locator =>
  page.getByRole("separator", { name: "Resize sidebar" });
const peek = (page: Page): Locator =>
  page.locator('[data-slot="app-shell-sidebar-peek"]');

const widthOf = async (locator: Locator): Promise<number> =>
  Math.round((await locator.boundingBox())?.width ?? 0);

let created: ConversationId[] = [];

test.beforeEach(async ({ baseURL, page }) => {
  const api = await apiFor(page, baseURL ?? "");
  const long = await api.conversations.create({ title: LONG_TITLE });
  const short = await api.conversations.create({ title: SHORT_TITLE });
  created = [long.id, short.id];
  await page.goto(`/c/${long.id}`);
  await composerReady(page);
  // A phone has the sidebar in a drawer, closed.
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await expect(row(page, LONG_TITLE)).toBeVisible();
  }
});

test.afterEach(async ({ baseURL, page }) => {
  // Out of the other specs' sidebars.
  const api = await apiFor(page, baseURL ?? "");
  await Promise.all(
    created.map((id) => api.conversations.update({ archived: true, id }))
  );
});

test("rows are 36px with a clear active fill, a fade and quiet actions", async ({
  page,
}) => {
  const active = row(page, LONG_TITLE);
  const idle = row(page, SHORT_TITLE);
  expect(Math.round((await active.boundingBox())?.height ?? 0)).toBe(36);
  const fill = (locator: Locator) =>
    locator.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await fill(active)).not.toBe(await fill(idle));
  await expect(active).toHaveAttribute("aria-current", "page");

  // The title fades out; it isn't cut early with an ellipsis.
  const title = active.locator("span");
  expect(
    await title.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        ellipsis: style.textOverflow === "ellipsis",
        mask: style.maskImage.includes("linear-gradient"),
      };
    })
  ).toEqual({ ellipsis: false, mask: true });

  // The full title shows on hover, only when some of it is hidden.
  await active.hover();
  await expect(active).toHaveAttribute("title", LONG_TITLE);
  await idle.hover();
  await expect(idle).not.toHaveAttribute("title");

  // ⋯ shows on hover or focus only.
  const actions = sidebar(page).getByRole("button", {
    name: `Actions for ${LONG_TITLE}`,
  });
  await expect(actions).toHaveCSS("opacity", "0");
  await active.hover();
  await expect(actions).toHaveCSS("opacity", "1");
});

test("the edge drags and nudges, and the width survives a reload without a jump", async ({
  page,
}) => {
  const aside = sidebar(page);
  const edge = await hydrated(handle(page));
  await expect(edge).toHaveAttribute("aria-valuenow", "260");
  expect(await widthOf(aside)).toBe(260);

  const box = await edge.boundingBox();
  if (!box) {
    throw new Error("no resize handle");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 8 });
  await page.mouse.up();
  await expect(edge).toHaveAttribute("aria-valuenow", "340");
  expect(await widthOf(aside)).toBe(340);
  // Dragging selected nothing.
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");

  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(edge).toHaveAttribute("aria-valuenow", "324");

  // Watch the sidebar from the first parsed byte: every width it had.
  await page.addInitScript(() => {
    const seen = new Set<number>();
    (window as unknown as { __widths: Set<number> }).__widths = seen;
    const check = () => {
      const node = document.querySelector(
        '[data-slot="app-shell-sidebar"] aside'
      );
      const width = node ? Math.round(node.getBoundingClientRect().width) : 0;
      if (width > 0) {
        seen.add(width);
      }
    };
    new MutationObserver(check).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const frame = () => {
      check();
      if (document.readyState !== "complete") {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  });
  await page.reload();
  await composerReady(page);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "324");
  expect(
    await page.evaluate(() => [
      ...(window as unknown as { __widths: Set<number> }).__widths,
    ])
  ).toEqual([324]);

  // Double-click puts it back.
  await handle(page).dblclick();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "260");
  expect(await widthOf(sidebar(page))).toBe(260);
});

test("collapse and expand; collapsed, the edge peeks over the page", async ({
  page,
}) => {
  const toggle = page.getByRole("button", { name: "Toggle sidebar" });
  await page.keyboard.press("ControlOrMeta+B");
  await expect(page.locator('[data-slot="app-shell-sidebar"]')).toHaveCount(0);
  await expect(peek(page)).not.toHaveAttribute("data-open");

  const content = page.getByRole("main");
  const before = await content.boundingBox();
  await page.mouse.move(400, 400);
  await page.mouse.move(6, 400, { steps: 4 });
  await expect(peek(page)).toHaveAttribute("data-open", "");
  await expect(sidebar(page)).toBeVisible();
  // An overlay: nothing moved.
  expect(await content.boundingBox()).toEqual(before);

  // A row's menu keeps it open with the pointer outside.
  await row(page, SHORT_TITLE).hover();
  await sidebar(page)
    .getByRole("button", { name: `Actions for ${SHORT_TITLE}` })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.mouse.move(900, 400, { steps: 4 });
  await page.waitForTimeout(1000);
  await expect(peek(page)).toHaveAttribute("data-open", "");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // Then it goes, 500ms after the pointer left (and the menu closed).
  await expect(peek(page)).not.toHaveAttribute("data-open");
  await expect(sidebar(page)).toBeHidden();

  await clickHydrated(toggle);
  await expect(page.locator('[data-slot="app-shell-sidebar"]')).toBeVisible();
  await expect(peek(page)).toHaveCount(0);
});

test("rename works after other rows' menus were opened and closed", async ({
  page,
}) => {
  const actionsFor = (title: string) =>
    sidebar(page).getByRole("button", { name: `Actions for ${title}` });
  const menu = page.getByRole("menu");

  await row(page, SHORT_TITLE).hover();
  await actionsFor(SHORT_TITLE).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await row(page, SHORT_TITLE).hover();
  await actionsFor(SHORT_TITLE).click();
  await expect(menu).toBeVisible();
  await page.mouse.click(800, 300);
  await expect(menu).toBeHidden();

  await row(page, LONG_TITLE).hover();
  await actionsFor(LONG_TITLE).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = sidebar(page).getByRole("textbox", { name: "Chat title" });
  await expect(input).toBeFocused();
  await page.waitForTimeout(400);
  await expect(input).toBeFocused();
  await page.keyboard.type("Sidebar spec: renamed");
  await page.keyboard.press("Enter");
  await expect(row(page, "Sidebar spec: renamed")).toBeVisible();
});

test("the conversation keeps 480px: at 900px with the panel open the sidebar peeks", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 900 });
  await page
    .locator('[data-slot="app-header"]')
    .getByRole("button", { exact: true, name: "Files" })
    .click();
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-slot="app-shell-sidebar"]')).toHaveCount(0);
  const panelHandle = page.getByRole("separator", {
    name: "Resize side panel",
  });
  await expect(panelHandle).toHaveAttribute("aria-valuemax", "420");
  expect(await widthOf(page.getByRole("main"))).toBeGreaterThanOrEqual(480);

  await page.setViewportSize({ height: 800, width: 1024 });
  await expect(page.locator('[data-slot="app-shell-sidebar"]')).toBeVisible();
  expect(await widthOf(page.getByRole("main"))).toBeGreaterThanOrEqual(480);
  expect(await widthOf(panel)).toBeGreaterThanOrEqual(280);
  // Leave it closed for the specs that follow.
  await page
    .locator('[data-slot="app-header"]')
    .getByRole("button", { exact: true, name: "Files" })
    .click();
  await expect(panel).toBeHidden();
});

test.describe("on a phone", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });

  test("the sidebar is a drawer of 44px rows that closes on navigation", async ({
    page,
  }) => {
    await clickHydrated(page.getByRole("button", { name: "Toggle sidebar" }));
    const drawer = page.getByRole("dialog", { name: "Chats" });
    await expect(drawer).toBeVisible();
    const short = drawer.getByRole("button", {
      exact: true,
      name: SHORT_TITLE,
    });
    expect(Math.round((await short.boundingBox())?.height ?? 0)).toBe(44);
    await short.click();
    await expect(page).toHaveURL(new RegExp(`/c/${created[1]}`));
    await expect(drawer).toBeHidden();
  });
});
