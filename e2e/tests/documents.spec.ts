import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";
import type { ArtifactId } from "@workspace/contract/schemas/common";

import { apiFor, eventually } from "../support/api";
import { conversationIdOf, expectReply, send } from "../support/chat";
import { storageStateFor } from "../support/users";

// Documents (126) as a person meets them. The model writes a document in
// Markdown and it opens as rich text beside the chat; the model then
// changes one section by its heading. Ada edits it on its own page, and
// each pause in her typing saves a new version; she exports it as
// Markdown. (Plan mode's plans are Documents too: plan-mode.spec.ts.)

test.describe.configure({ mode: "serial" });

const APPROVE = /^Approve( all)?$/;
const ARTIFACT_URL = /\/artifacts\/[0-9a-f-]{36}$/;
const TITLE = "Trip brief";
const SAVED_V1 = /Tool result: Saved "Trip brief" as version 1/;
const SAVED_V2 = /Tool result: Saved "Trip brief" as version 2/;
const READ_ONLY = /Version \d+, read only/;
const BRIEF = [
  "# Trip brief",
  "",
  "## Plan",
  "Walk the harbour.",
  "",
  "## Packing",
  "- Boots",
  "- A map",
].join("\n");

const signedIn = async (browser: Browser, baseURL: string) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const page = await context.newPage();
  return { api: await apiFor(context, baseURL), context, page };
};

/** Approves the one call the run is waiting on. */
const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

/** `DOCUMENTS_SCREENSHOTS=<dir>` saves the views, light and dark, desktop and 375px. */
const SCREENS = process.env.DOCUMENTS_SCREENSHOTS;

const screens = async (page: Page, name: string) => {
  if (!SCREENS) {
    return;
  }
  await mkdir(SCREENS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    for (const [size, viewport] of [
      ["desktop", { height: 900, width: 1280 }],
      ["375", { height: 812, width: 375 }],
    ] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: one screen at a time.
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.colorScheme = theme;
      }, scheme);
      await page.screenshot({
        path: join(SCREENS, `${name}-${scheme}-${size}.png`),
      });
    }
  }
  await page.setViewportSize({ height: 720, width: 1280 });
};

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document" });

let made: ArtifactId;

test("the model writes a document, then changes one section of it", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto("/");
  await send(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: BRIEF, title: TITLE, type: "document" })}]`
  );
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_V1);
  const chat = await conversationIdOf(page);
  const [artifact] = await api.artifacts.list({ conversationId: chat });
  expect(artifact).toMatchObject({ kind: "document", title: TITLE });
  made = artifact?.id as ArtifactId;

  // It opens beside the chat as rich text, not Markdown source.
  await page.getByRole("button", { name: `Open artifact: ${TITLE}` }).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(editor.locator("li", { hasText: "Boots" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: TITLE })
  ).toBeVisible();

  // One section, by its heading; the rest stays.
  await send(
    page,
    `[tool:update_artifact ${JSON.stringify({
      artifactId: made,
      edit: {
        content: "Walk the harbour, then the lighthouse.",
        heading: "Plan",
        operation: "replace_section",
      },
    })}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, SAVED_V2);
  const versions = await api.artifacts.listVersions({ id: made });
  expect(versions).toHaveLength(2);
  const latest = versions[1]?.content ?? "";
  expect(latest).toContain("then the lighthouse.");
  expect(latest).toContain("Boots");
  expect(latest).not.toContain('Walk the harbour."');
  expect(versions[1]?.editedBy ?? null).toBeNull();
  // The panel shows the new version.
  await expect(editor).toContainText("then the lighthouse.");
  await screens(page, "panel");
  await context.close();
});

test("Ada edits it on its own page, and a pause in typing saves a version", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto("/artifacts");
  // The page's list, not the rail's Recent panel, which links it too (181).
  await page
    .getByRole("main")
    .getByRole("link", { exact: true, name: TITLE })
    .click();
  await expect(page).toHaveURL(ARTIFACT_URL);

  // Claude's document view: a title bar with Chat and Share, the toolbar,
  // a serif title and the date and author chips.
  await expect(
    page.getByRole("button", { exact: true, name: "Chat" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Share" })
  ).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await expect(
    page.locator("article").getByText("Ada Admin", { exact: true })
  ).toBeVisible();
  const status = page.locator("[data-save-state]");
  await expect(status).toHaveAttribute("data-save-state", "saved");
  await screens(page, "page");

  const editor = editorOf(page);
  // ProseMirror is attached (it sets contenteditable) before a click can
  // place the caret.
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.getByText("A map", { exact: true }).click();
  // The caret lands in the list (the toolbar says so) before typing.
  await expect(
    page.getByRole("button", { name: "Bulleted list" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A hat");
  await expect(status).toHaveAttribute("data-save-state", "saved", {
    timeout: 10_000,
  });

  const versions = await eventually(
    () => api.artifacts.listVersions({ id: made }),
    (each) => each.length === 3
  );
  expect(versions[2]?.editedBy).toBeTruthy();
  expect(versions[2]?.content).toContain("A hat");
  expect(versions[2]?.content).toContain("then the lighthouse.");

  // A heading from the toolbar, saved too.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Contacts");
  await page.getByRole("button", { name: "Text style: Text" }).click();
  await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
  await expect(editor.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await eventually(
    () => api.artifacts.listVersions({ id: made }),
    (each) =>
      (each.at(-1)?.content ?? "").includes(
        '"level":2},"content":[{"type":"text","text":"Contacts"'
      )
  );

  // An older version opens read only.
  await page.getByRole("button", { name: "Older version" }).click();
  await expect(page.getByText(READ_ONLY)).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(
    0
  );
  await context.close();
});

test("exports the document as Markdown", async ({ baseURL, browser }) => {
  const { context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto(`/artifacts/${made}`);
  await expect(editorOf(page)).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Trip-brief.md");
  const text = await readFile((await file.path()) ?? "", "utf8");
  expect(text).toContain("# Trip brief");
  expect(text).toContain("## Plan\n\nWalk the harbour, then the lighthouse.");
  expect(text).toContain("- A hat");
  expect(text).toContain("## Contacts");
  await context.close();
});
