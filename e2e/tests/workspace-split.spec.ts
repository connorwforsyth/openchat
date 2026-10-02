import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  chatHeader,
  composerReady,
  conversationIdOf,
  expectReply,
  openWorkspace,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

const SEEDED = /Tool result: .*seeded/;

// The Workspace panel as two halves (097): the browser on top, the files
// below, with a divider that's kept across a reload. A file opens below while
// the page stays above; either half maximises; a narrow panel shows one half
// at a time.

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("ada") });

/** A chat whose workspace has a page and a file, made once. */
let chatPath: string;

const browserOf = (panel: Locator) =>
  panel.getByRole("region", { name: "Browser" });
const listOf = (panel: Locator) =>
  panel.getByRole("navigation", { name: "Workspace contents" });
const dividerOf = (page: Page) =>
  page.getByRole("separator", { name: "Resize the browser" });
const editorIn = (page: Page) =>
  page.locator('[data-slot="code-editor"] [contenteditable="true"]');
const heightOf = async (locator: Locator) =>
  Math.round((await locator.boundingBox())?.height ?? 0);

/** Opens the chat with its panel, the page loaded on top. */
const openPanel = async (page: Page) => {
  await page.goto(chatPath);
  await composerReady(page);
  const panel = await openWorkspace(page);
  await expect(
    browserOf(panel)
      .frameLocator("iframe")
      .getByRole("heading", { name: "Site" })
  ).toBeVisible();
  return panel;
};

test("a chat with a page and a file", async ({ page }) => {
  await page.goto("/");
  const script = [
    "mkdir -p src",
    "printf 'export const add = 1;\\n' > src/math.ts",
    "printf '<!doctype html><h1>Site</h1>' > index.html",
    "echo seeded",
  ].join(" && ");
  await send(page, `[tool:bash {"command": ${JSON.stringify(script)}}]`);
  await expectReply(page, SEEDED);
  chatPath = `/c/${await conversationIdOf(page)}`;
});

test("the browser sits over the files, and a file opens below while the page stays", async ({
  page,
}) => {
  const panel = await openPanel(page);
  const browser = browserOf(panel);
  const list = listOf(panel);
  await expect(list).toBeVisible();
  const top = await browser.boundingBox();
  const below = await list.boundingBox();
  if (!(top && below)) {
    throw new Error("no halves");
  }
  expect(top.y + top.height).toBeLessThanOrEqual(below.y + 1);
  // One Close, at the top.
  await expect(panel.getByRole("button", { name: "Close panel" })).toHaveCount(
    1
  );
  await expect(
    browser.getByRole("button", { name: "Close panel" })
  ).toBeVisible();

  await panel.getByRole("treeitem", { name: "math.ts" }).click();
  await expect(editorIn(page)).toContainText("export const add");
  await expect(
    browser.frameLocator("iframe").getByRole("heading", { name: "Site" })
  ).toBeVisible();
});

test("the divider drags, and a reload keeps where it was left", async ({
  page,
}) => {
  const panel = await openPanel(page);
  const browser = browserOf(panel);
  const divider = dividerOf(page);
  const before = await heightOf(browser);
  const edge = await divider.boundingBox();
  if (!edge) {
    throw new Error("no divider");
  }
  const x = edge.x + edge.width / 2;
  const y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => heightOf(browser)).toBeGreaterThan(before + 100);
  const dragged = await heightOf(browser);

  // The panel stays open across a reload, at the same split.
  await page.reload();
  const reopened = page.getByRole("region", { name: "Workspace" });
  await expect(browserOf(reopened)).toBeVisible();
  await expect
    .poll(() => heightOf(browserOf(reopened)))
    .toBeGreaterThanOrEqual(dragged - 2);
  expect(await heightOf(browserOf(reopened))).toBeLessThanOrEqual(dragged + 2);

  // ↑ nudges it; a double-click puts it back in the middle.
  await dividerOf(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(() => heightOf(browserOf(reopened)))
    .toBeLessThan(dragged - 8);
  await dividerOf(page).dblclick();
  await expect(dividerOf(page)).toHaveAttribute("aria-valuenow", "50");
});

test("either half maximises and restores", async ({ page }) => {
  const panel = await openPanel(page);
  const browser = browserOf(panel);
  const list = listOf(panel);
  const maxBrowser = panel.getByRole("button", {
    name: "Maximise the browser",
  });
  await maxBrowser.click();
  await expect(list).toBeHidden();
  await expect(dividerOf(page)).toHaveCount(0);
  await maxBrowser.click();
  await expect(list).toBeVisible();

  const maxFiles = panel.getByRole("button", { name: "Maximise the files" });
  await maxFiles.click();
  await expect(browser).toBeHidden();
  // Close moved down to the files' row while the browser is away.
  await expect(
    panel.getByRole("button", { name: "Close panel" })
  ).toBeVisible();
  await maxFiles.click();
  await expect(browser).toBeVisible();
});

// 137: the header's Files and Globe in place of one Workspace toggle.
test("Files and the Globe open their halves, switch, and close on a second press", async ({
  page,
}) => {
  await page.goto(chatPath);
  await composerReady(page);
  const header = chatHeader(page);
  const files = header.getByRole("button", { exact: true, name: "Files" });
  const globe = header.getByRole("button", { name: "Browser" });
  const sidePanel = page.getByRole("complementary", { name: "Side panel" });
  const panel = page.getByRole("region", { name: "Workspace" });
  if ((await files.getAttribute("aria-pressed")) === "true") {
    await files.click();
  }
  await expect(sidePanel).toBeHidden();

  // The Globe: the browser, the whole panel.
  await globe.click();
  await expect(globe).toHaveAttribute("aria-pressed", "true");
  await expect(files).toHaveAttribute("aria-pressed", "false");
  await expect(
    browserOf(panel)
      .frameLocator("iframe")
      .getByRole("heading", { name: "Site" })
  ).toBeVisible();
  await expect(listOf(panel)).toBeHidden();

  // Files: the files come back, under the page.
  await files.click();
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(globe).toHaveAttribute("aria-pressed", "false");
  await expect(listOf(panel)).toBeVisible();
  await expect(browserOf(panel)).toBeVisible();

  // The Globe again switches back; a second press closes.
  await globe.click();
  await expect(listOf(panel)).toBeHidden();
  await globe.click();
  await expect(sidePanel).toBeHidden();
  await expect(globe).toHaveAttribute("aria-pressed", "false");

  // Files opens it too, and a second press closes.
  await files.click();
  await expect(listOf(panel)).toBeVisible();
  await files.click();
  await expect(sidePanel).toBeHidden();
});

test("the device menu draws the page at a tablet's or a phone's width, per chat", async ({
  page,
}) => {
  await page.goto(chatPath);
  await composerReady(page);
  const globe = chatHeader(page).getByRole("button", { name: "Browser" });
  if ((await globe.getAttribute("aria-pressed")) !== "true") {
    await globe.click();
  }
  const panel = page.getByRole("region", { name: "Workspace" });
  const browser = browserOf(panel);
  const frame = browser.locator("iframe");
  await expect(
    browser.frameLocator("iframe").getByRole("heading", { name: "Site" })
  ).toBeVisible();
  const stage = browser.locator("[data-device]");
  await expect(stage).toHaveAttribute("data-device", "desktop");
  const full = Math.round((await frame.boundingBox())?.width ?? 0);
  expect(full).toBeGreaterThan(390);

  await browser.getByRole("button", { name: "Device: Desktop" }).click();
  await page.getByRole("menuitemradio", { name: "Phone (390 px)" }).click();
  await expect(stage).toHaveAttribute("data-device", "phone");
  await expect
    .poll(async () => Math.round((await stage.boundingBox())?.width ?? 0))
    .toBe(390);
  // Centred in the half.
  const half = await browser.boundingBox();
  const box = await stage.boundingBox();
  if (!(half && box)) {
    throw new Error("no stage");
  }
  const left = box.x - half.x;
  const right = half.x + half.width - (box.x + box.width);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(2);

  // Kept for the session: a reload shows the phone again.
  await page.reload();
  await composerReady(page);
  const reopened = browserOf(page.getByRole("region", { name: "Workspace" }));
  await expect(reopened.locator("[data-device]")).toHaveAttribute(
    "data-device",
    "phone"
  );

  // Back to the desktop for the specs that follow.
  await reopened
    .getByRole("button", { name: "Device: Phone (390 px)" })
    .click();
  await page.getByRole("menuitemradio", { name: "Desktop" }).click();
  await expect(reopened.locator("[data-device]")).toHaveAttribute(
    "data-device",
    "desktop"
  );
});

test("a narrow panel shows one half at a time", async ({ page }) => {
  const panel = await openPanel(page);
  // Drag the side panel's edge to 360px, under the 420px the halves stack at.
  const handle = page.getByRole("separator", { name: "Resize side panel" });
  const edge = await handle.boundingBox();
  const aside = await page
    .locator('aside[aria-label="Side panel"]')
    .boundingBox();
  if (!(edge && aside)) {
    throw new Error("no panel edge");
  }
  const y = edge.y + edge.height / 2;
  await page.mouse.move(edge.x + edge.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + (aside.width - 360), y, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBe(360);

  const browser = browserOf(panel);
  const list = listOf(panel);
  // Opened with Files (137), so it's the files' turn: the list.
  await expect(list).toBeVisible();
  await expect(browser).toBeHidden();
  await expect(dividerOf(page)).toHaveCount(0);
  await panel.getByRole("button", { name: "Preview" }).click();
  await expect(browser).toBeVisible();
  await expect(list).toBeHidden();
  await panel.getByRole("button", { name: "Back to the list" }).click();
  await expect(list).toBeVisible();
  await expect(browser).toBeHidden();
  // Picking the Preview put the panel on the browser's section (the Globe
  // is pressed); Files and then the Globe switch whose turn it is.
  const header = chatHeader(page);
  const globe = header.getByRole("button", { name: "Browser" });
  await expect(globe).toHaveAttribute("aria-pressed", "true");
  await header.getByRole("button", { exact: true, name: "Files" }).click();
  await expect(list).toBeVisible();
  await globe.click();
  await expect(browser).toBeVisible();
  await expect(list).toBeHidden();
});
