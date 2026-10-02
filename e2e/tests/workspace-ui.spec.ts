import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  chatHeader,
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

const SEEDED = /Tool result: .*seeded/;
const FOUND_ONE = /^1 found$/;

// The Workspace panel's layout and keys (070): one header row per view,
// file search ("/", ↓/↑ to preview, Enter to open into the editor, Escape to
// clear), the Preview/Code switch and the way back on a narrow panel, and
// focus: opening moves it in, Escape closes, closing hands it back to the
// toggle. Typing "d" in the editor no longer flips the theme.

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("ada") });

/** A chat whose workspace has a few files, made once. */
let chatPath: string;

const toggleOf = (page: Page) =>
  chatHeader(page).getByRole("button", { exact: true, name: "Files" });
const panelOf = (page: Page) => page.getByRole("region", { name: "Workspace" });
const searchIn = (panel: Locator) =>
  panel.getByRole("combobox", { name: "Search files" });
const editorIn = (page: Page) =>
  page.locator('[data-slot="code-editor"] [contenteditable="true"]');
/** The path the main area's header row shows. */
const shownPath = (panel: Locator) =>
  panel.locator('[data-slot="workspace-header"] span[title]');

/** Whether focus is inside the panel, looking into shadow roots. */
const focusInPanel = (page: Page) =>
  page.evaluate(() => {
    const region = document.querySelector('section[aria-label="Workspace"]');
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    let node: Node | null = active;
    while (node) {
      if (region?.contains(node)) {
        return true;
      }
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  });

test("a chat with a few files", async ({ page }) => {
  await page.goto("/");
  const script = [
    "mkdir -p src docs",
    "printf '# Notes\\n\\nSome notes.\\n' > docs/notes.md",
    "printf 'export const add = 1;\\n' > src/math.ts",
    "printf '<!doctype html><h1>Site</h1>' > index.html",
    "echo seeded",
  ].join(" && ");
  await send(page, `[tool:bash {"command": ${JSON.stringify(script)}}]`);
  await expectReply(page, SEEDED);
  chatPath = `/c/${await conversationIdOf(page)}`;
});

test("the panel takes focus when it opens, and Escape hands it back to the toggle", async ({
  page,
}) => {
  await page.goto(chatPath);
  await composerReady(page);
  // One header row: no "Workspace" title bar over the panel.
  await toggleOf(page).click();
  const panel = panelOf(page);
  await expect(
    panel.getByRole("treeitem", { name: "index.html" })
  ).toBeVisible();
  await expect.poll(() => focusInPanel(page)).toBe(true);
  await expect(page.getByRole("heading", { name: "Workspace" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close panel" })).toHaveCount(
    1
  );

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(toggleOf(page)).toBeFocused();

  // S opens it from nowhere in particular; closing still lands on the toggle.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("s");
  await expect(panel).toBeVisible();
  await expect.poll(() => focusInPanel(page)).toBe(true);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toHaveCount(0);
  await expect(toggleOf(page)).toBeFocused();
});

test("file search: '/' to search, ↓ to preview, Enter into the editor, Preview/Code, and back", async ({
  page,
}) => {
  await page.goto(chatPath);
  await composerReady(page);
  await toggleOf(page).click();
  const panel = panelOf(page);
  await expect(
    panel.getByRole("treeitem", { name: "index.html" })
  ).toBeVisible();
  await expect.poll(() => focusInPanel(page)).toBe(true);

  await page.keyboard.press("/");
  await expect(searchIn(panel)).toBeFocused();
  await page.keyboard.type("math");
  await expect(panel.getByText(FOUND_ONE)).toBeVisible();
  // The results replace the tree.
  await expect(panel.getByRole("tree")).toBeHidden();

  await page.keyboard.press("ArrowDown");
  await expect(shownPath(panel)).toHaveAttribute("title", "src/math.ts");
  await expect(searchIn(panel)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editorIn(page)).toBeFocused();

  // "d" typed in the editor is text, not the theme key (070).
  const theme = await page.evaluate(() => document.documentElement.className);
  await page.keyboard.press("End");
  await page.keyboard.type(" // dd");
  await expect(editorIn(page)).toContainText("// dd");
  expect(await page.evaluate(() => document.documentElement.className)).toBe(
    theme
  );

  // Escape clears the search and goes back to the tree.
  await searchIn(panel).click();
  await page.keyboard.press("Escape");
  await expect(searchIn(panel)).toHaveValue("");
  await expect(panel.getByRole("tree")).toBeVisible();

  // An HTML file opens in the browser on top and its code below (097), so
  // there's no Preview/Code switch.
  await searchIn(panel).fill("index");
  await page.keyboard.press("Enter");
  await expect(
    panel.frameLocator("iframe").getByRole("heading", { name: "Site" })
  ).toBeVisible();
  await expect(editorIn(page)).toContainText("Site");
  await expect(panel.getByRole("group", { name: "Show as" })).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "Address" })).toHaveValue(
    "/index.html"
  );
});

test("a narrow panel: the toolbar fits in one row and there's a way back to the list", async ({
  page,
}) => {
  await page.goto(chatPath);
  await composerReady(page);
  await toggleOf(page).click();
  const panel = panelOf(page);
  await panel.getByRole("treeitem", { name: "index.html" }).click();
  await expect(panel.getByRole("toolbar", { name: "Browser" })).toBeVisible();

  // Drag the panel's edge to 340px.
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
  await page.mouse.move(edge.x + edge.width / 2 + (aside.width - 340), y, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBe(340);

  const toolbar = panel.getByRole("toolbar", { name: "Browser" });
  const fits = await toolbar.evaluate((element) => ({
    address: element.querySelector("form")?.getBoundingClientRect().width ?? 0,
    overflow: element.scrollWidth - element.clientWidth,
  }));
  expect(fits.overflow).toBeLessThanOrEqual(0);
  expect(fits.address).toBeGreaterThanOrEqual(120);

  // The list and the page take turns: back to the list, then the same file.
  const list = panel.getByRole("navigation", { name: "Workspace contents" });
  await expect(list).toBeHidden();
  await panel.getByRole("button", { name: "Back to the list" }).click();
  await expect(list).toBeVisible();
  await panel.getByRole("treeitem", { name: "index.html" }).click();
  await expect(list).toBeHidden();
  await expect(toolbar).toBeVisible();
});
