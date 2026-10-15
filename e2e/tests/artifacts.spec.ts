import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";
import type {
  ArtifactId,
  ConversationId,
} from "@workspace/contract/schemas/common";

import { apiFor } from "../support/api";
import { conversationIdOf, expectReply, send } from "../support/chat";
import { storageStateFor, type UserName, users } from "../support/users";

// The Artifacts page (124). Ada makes two artifacts in a chat, finds them
// from the sidebar's Artifacts item, filters and renames one, shares it
// with Ben (who sees it under "Shared with you", read-only, with no way
// into Ada's chat), goes back to the chat that made it, and uses it in a
// new chat: that chat's model sees its latest version and saves the next
// one. Last, she deletes it and it's gone for Ben too.

test.describe.configure({ mode: "serial" });

const APPROVE = /^Approve( all)?$/;
const SAVED_GUIDE = /Tool result: Saved "Harbour guide" as version 1/;
const SAVED_WELCOME = /Tool result: Saved "Welcome page" as version 1/;
const SAVED_V2 = /Tool result: Saved "Harbour walk" as version 2/;
const CHAT_URL = /\/c\/[0-9a-f-]{36}$/;
const ARTIFACTS_URL = /\/artifacts$/;
const ARTIFACT_URL = /\/artifacts\/[0-9a-f-]{36}$/;

const signedIn = async (browser: Browser, baseURL: string, who: UserName) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateFor(who),
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

/** The list row for an artifact, by its title. */
const rowOf = (page: Page, title: string) =>
  page.locator("li[data-artifact-id]").filter({
    has: page.getByRole("link", { exact: true, name: title }),
  });

/** The row's ⋯ menu (a chat in the sidebar can have the same title). */
const openMenu = async (page: Page, title: string) => {
  await rowOf(page, title)
    .getByRole("button", { name: `Actions for ${title}` })
    .click();
};

/** `ARTIFACTS_SCREENSHOTS=<dir>` saves the pages, light and dark, desktop and 375px. */
const SCREENS = process.env.ARTIFACTS_SCREENSHOTS;

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
        fullPage: true,
        path: join(SCREENS, `${name}-${scheme}-${size}.png`),
      });
    }
  }
  await page.setViewportSize({ height: 720, width: 1280 });
};

let madeIn: ConversationId;
let guide: ArtifactId;

test("artifacts made in a chat are listed on the Artifacts page", async ({
  baseURL,
  browser,
}) => {
  const ada = await signedIn(browser, baseURL ?? "", "ada");
  const { page } = ada;
  await page.goto("/");
  await send(
    page,
    '[tool:create_artifact {"type": "markdown", "title": "Harbour guide", "content": "Day one: the harbour."}]'
  );
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_GUIDE);
  madeIn = await conversationIdOf(page);
  await send(
    page,
    '[tool:create_artifact {"type": "html", "title": "Welcome page", "content": "<!doctype html><html><body><h1>Welcome aboard</h1></body></html>"}]'
  );
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_WELCOME);
  const made = await ada.api.artifacts.list({ conversationId: madeIn });
  guide = made.find((each) => each.title === "Harbour guide")?.id as ArtifactId;
  expect(guide).toBeTruthy();

  // From the sidebar, beside Library.
  await page.getByRole("link", { exact: true, name: "Artifacts" }).click();
  await expect(page).toHaveURL(ARTIFACTS_URL);
  await expect(
    page.getByRole("heading", { level: 1, name: "Artifacts" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Make something new" })
  ).toBeVisible();
  const row = rowOf(page, "Harbour guide");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Only you");
  // A markdown artifact reads as Markdown; "Document" is the rich-text kind (126).
  await expect(row.getByRole("img", { name: "Markdown" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Today" }).getByRole("link", {
      exact: true,
      name: "Welcome page",
    })
  ).toBeVisible();
  await ada.context.close();
});

test("the list filters by kind, search and tab", async ({
  baseURL,
  browser,
}) => {
  const { context, page } = await signedIn(browser, baseURL ?? "", "ada");
  await page.goto("/artifacts");
  await expect(rowOf(page, "Harbour guide")).toBeVisible();

  await page.getByRole("button", { name: "Kind: All kinds" }).click();
  await page.getByRole("menuitemradio", { name: "Web page" }).click();
  await expect(rowOf(page, "Welcome page")).toBeVisible();
  await expect(rowOf(page, "Harbour guide")).toHaveCount(0);
  await page.getByRole("button", { name: "Kind: Web page" }).click();
  await page.getByRole("menuitemradio", { name: "All kinds" }).click();

  // Search reads the content too, not only the title.
  await page
    .getByRole("searchbox", { name: "Search artifacts" })
    .fill("aboard");
  await expect(rowOf(page, "Welcome page")).toBeVisible();
  await expect(rowOf(page, "Harbour guide")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search artifacts" }).fill("");

  await page.getByRole("tab", { name: "Shared with you" }).click();
  await expect(rowOf(page, "Harbour guide")).toHaveCount(0);
  await page.getByRole("tab", { name: "Yours" }).click();
  await expect(rowOf(page, "Harbour guide")).toBeVisible();

  // The grid shows the same artifacts as cards.
  await page.getByRole("button", { exact: true, name: "Grid" }).click();
  await expect(rowOf(page, "Harbour guide")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "List" }).click();
  await context.close();
});

test("opening an artifact shows it on its own page and records the view", async ({
  baseURL,
  browser,
}) => {
  const { context, page } = await signedIn(browser, baseURL ?? "", "ada");
  await page.goto("/artifacts");
  await rowOf(page, "Harbour guide")
    .getByRole("link", { name: "Harbour guide" })
    .click();
  await expect(page).toHaveURL(ARTIFACT_URL);
  await expect(page.getByText("Day one: the harbour.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open in chat" })
  ).toBeVisible();
  if (SCREENS) {
    await screens(page, "artifact");
  }
  await page.getByRole("link", { name: "Artifacts" }).first().click();
  await expect(rowOf(page, "Harbour guide")).toContainText("Viewed");
  if (SCREENS) {
    await screens(page, "artifacts");
  }
  await context.close();
});

test("an artifact can be renamed from its menu", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "", "ada");
  await page.goto("/artifacts");
  await openMenu(page, "Harbour guide");
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Harbour walk");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(rowOf(page, "Harbour walk")).toBeVisible();
  expect((await api.artifacts.get({ id: guide })).title).toBe("Harbour walk");
  await context.close();
});

test("a shared artifact is listed for the person it's shared with, read-only", async ({
  baseURL,
  browser,
}) => {
  const ada = await signedIn(browser, baseURL ?? "", "ada");
  await ada.page.goto("/artifacts");
  await openMenu(ada.page, "Harbour walk");
  await ada.page.getByRole("menuitem", { name: "Share" }).click();
  const dialog = ada.page.getByRole("dialog", { name: "Share Harbour walk" });
  await dialog
    .getByRole("textbox", { name: "Find people, teams or orgs" })
    .fill("Ben");
  await dialog
    .getByRole("list", { name: "Matches" })
    .getByRole("button", { name: users.ben.name })
    .click();
  await expect(
    dialog.getByRole("region", { name: "People with access" })
  ).toContainText(users.ben.name);
  await ada.page.keyboard.press("Escape");
  await expect(rowOf(ada.page, "Harbour walk")).toContainText("Shared");
  await ada.context.close();

  const ben = await signedIn(browser, baseURL ?? "", "ben");
  await ben.page.goto("/artifacts");
  await ben.page.getByRole("tab", { name: "Shared with you" }).click();
  const row = rowOf(ben.page, "Harbour walk");
  await expect(row).toContainText(`Shared by ${users.ada.name}`);
  await expect(rowOf(ben.page, "Welcome page")).toHaveCount(0);
  // A viewer: no rename or delete, and Ada's chat isn't his to open.
  await openMenu(ben.page, "Harbour walk");
  await expect(
    ben.page.getByRole("menuitem", { name: "Use in chat" })
  ).toBeVisible();
  await expect(ben.page.getByRole("menuitem", { name: "Rename" })).toHaveCount(
    0
  );
  await expect(ben.page.getByRole("menuitem", { name: "Delete" })).toHaveCount(
    0
  );
  await expect(
    ben.page.getByRole("menuitem", { name: "Go to chat" })
  ).toHaveCount(0);
  await ben.page.keyboard.press("Escape");
  await row.getByRole("link", { name: "Harbour walk" }).click();
  await expect(ben.page.getByText("Day one: the harbour.")).toBeVisible();
  await expect(
    ben.page.getByRole("button", { name: "Open in chat" })
  ).toHaveCount(0);
  await ben.context.close();
});

test("Go to chat returns to the chat that made it", async ({
  baseURL,
  browser,
}) => {
  const { context, page } = await signedIn(browser, baseURL ?? "", "ada");
  await page.goto("/artifacts");
  await openMenu(page, "Harbour walk");
  await page.getByRole("menuitem", { name: "Go to chat" }).click();
  // 171: the chat opens with the artifact showing in its panel.
  await expect(page).toHaveURL(
    new RegExp(`/c/${madeIn}\\?artifact=[0-9a-f-]+$`)
  );
  await expect(
    page.getByRole("button", { name: "Open artifact: Harbour guide" })
  ).toBeVisible();
  await context.close();
});

test("Use in chat attaches it to a new chat, whose model sees and versions it", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "", "ada");
  await page.goto("/artifacts");
  await openMenu(page, "Harbour walk");
  await page.getByRole("menuitem", { name: "Use in chat" }).click();
  await page
    .getByRole("dialog", { name: "Use Harbour walk in a chat" })
    .getByRole("button", { name: "New chat" })
    .click();
  await expect(page).toHaveURL(CHAT_URL);
  const chat = await conversationIdOf(page);
  expect(chat).not.toBe(madeIn);
  expect(
    (await api.artifacts.list({ conversationId: chat })).map((each) => each.id)
  ).toEqual([guide]);

  // The model is given its latest version… (the reply renders as
  // Markdown, so the block's tags don't show, only what's inside them)
  await send(page, "[show:system]");
  const reply = await expectReply(page, "Day one: the harbour.");
  await expect(reply).toContainText("The user attached these artifacts");

  // …and can save the next one from here.
  await send(
    page,
    `[tool:update_artifact {"artifactId": "${guide}", "content": "Day one: the harbour. Day two: the hills."}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, SAVED_V2);
  const versions = await api.artifacts.listVersions({ id: guide });
  expect(
    versions.map((version) => [version.number, version.conversationId])
  ).toEqual([
    [1, madeIn],
    [2, chat],
  ]);
  await context.close();
});

test("deleting an artifact takes it away from everyone", async ({
  baseURL,
  browser,
}) => {
  const ada = await signedIn(browser, baseURL ?? "", "ada");
  await ada.page.goto("/artifacts");
  await openMenu(ada.page, "Harbour walk");
  await ada.page.getByRole("menuitem", { name: "Delete" }).click();
  await ada.page
    .getByRole("alertdialog", { name: "Delete Harbour walk?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(rowOf(ada.page, "Harbour walk")).toHaveCount(0);
  await expect(rowOf(ada.page, "Welcome page")).toBeVisible();
  await ada.context.close();

  const ben = await signedIn(browser, baseURL ?? "", "ben");
  await expect(ben.api.artifacts.get({ id: guide })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await ben.context.close();
});
