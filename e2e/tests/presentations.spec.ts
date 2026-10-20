import { readFile } from "node:fs/promises";

import { type Browser, expect, type Page, test } from "@playwright/test";
import type { ArtifactId } from "@workspace/contract/schemas/common";

import { apiFor } from "../support/api";
import { conversationIdOf, expectReply, send } from "../support/chat";
import { storageStateFor } from "../support/users";

// Presentations (164) as a person meets them. The mock model makes a deck
// of slide-ui slides; it draws in the artifact runtime; the model moves a
// slide with one edit; Ada presents it from the keyboard with its notes,
// and exports it to PowerPoint.

test.describe.configure({ mode: "serial" });

const APPROVE = /^Approve( all)?$/;
const TITLE = "Harbour talk";
const SAVED_V1 = /Tool result: Saved "Harbour talk" as version 1/;
const SAVED_V2 = /Tool result: Saved "Harbour talk" as version 2/;

const slide = (id: string, source: string, notes?: string) => ({
  id,
  source: [
    'import { Bullets, Closing, Title } from "@workspace/slide-ui";',
    source,
  ].join("\n"),
  ...(notes ? { notes } : {}),
});

const DECK = JSON.stringify({
  slides: [
    slide(
      "intro",
      'export default () => <Title eyebrow="Spring" title="Harbour walks" />;',
      "Welcome everyone."
    ),
    slide(
      "plan",
      'export default () => <Bullets steps title="The route" items={["The quay", "The lighthouse"]} />;'
    ),
    slide("end", 'export default () => <Closing title="Thank you" />;'),
  ],
  title: TITLE,
});

const signedIn = async (browser: Browser, baseURL: string) => {
  const context = await browser.newContext({
    acceptDownloads: true,
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const page = await context.newPage();
  return { api: await apiFor(context, baseURL), context, page };
};

const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

const deckOf = (page: Page) =>
  page
    .getByRole("region", { name: "Workspace" })
    .frameLocator(`iframe[title="Preview of ${TITLE}"]`);

let chatPath: string;
let made: ArtifactId;

test("the model makes a deck, it draws in the runtime, and a move_slide edit reorders it", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto("/");
  await send(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: DECK, title: TITLE, type: "presentation" })}]`
  );
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_V1);
  chatPath = `/c/${await conversationIdOf(page)}`;
  const [artifact] = await api.artifacts.list({
    conversationId: await conversationIdOf(page),
  });
  expect(artifact).toMatchObject({ kind: "presentation", title: TITLE });
  made = artifact?.id as ArtifactId;

  await page.getByRole("button", { name: `Open artifact: ${TITLE}` }).click();
  const deck = deckOf(page);
  await expect(
    deck.getByRole("heading", { name: "Harbour walks" })
  ).toBeVisible();
  await expect(deck.locator(".deck-slide")).toHaveCount(3);

  await send(
    page,
    `[tool:update_artifact ${JSON.stringify({
      artifactId: made,
      edit: { index: 0, operation: "move_slide", slide: "end" },
    })}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, SAVED_V2);
  const versions = await api.artifacts.listVersions({ id: made });
  expect(versions).toHaveLength(2);
  // Opened again, the panel shows the latest version.
  await page.reload();
  await page
    .getByRole("button", { name: `Open artifact: ${TITLE}` })
    .last()
    .click();
  await expect(deck.locator(".deck-slide").first()).toHaveAttribute(
    "data-slide",
    "end"
  );
  await context.close();
});

test("presents full window from the keyboard, with its notes, and exports to PowerPoint", async ({
  baseURL,
  browser,
}) => {
  const { context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto(chatPath);
  await page
    .getByRole("button", { name: `Open artifact: ${TITLE}` })
    .last()
    .click();
  const deck = deckOf(page);
  await expect(deck.getByRole("heading", { name: "Thank you" })).toBeVisible();

  await page.getByRole("button", { name: "Present" }).click();
  const stage = page.getByRole("dialog", { name: `Presenting ${TITLE}` });
  await expect(stage).toBeVisible();
  await expect(stage.getByText("Slide 1 of 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(stage.getByText("Slide 2 of 3")).toBeVisible();
  await expect(stage.getByLabel("Speaker notes")).toHaveText(
    "Welcome everyone."
  );
  await page.keyboard.press("ArrowRight");
  await expect(stage.getByText("Slide 3 of 3")).toBeVisible();
  // The route's points are steps: each key shows one, hidden till then.
  const points = deck.locator('[data-slide="plan"] [data-step]');
  await expect(points.nth(0)).toHaveAttribute("data-step-hidden", "");
  await page.keyboard.press("ArrowRight");
  await expect(points.nth(0)).not.toHaveAttribute("data-step-hidden", "");
  await expect(points.nth(1)).toHaveAttribute("data-step-hidden", "");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(stage.getByText("Slide 2 of 3")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stage).toBeHidden();

  await page.getByRole("button", { name: "Export" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "PowerPoint (.pptx)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Harbour-talk.pptx");
  const bytes = await readFile((await file.path()) ?? "");
  // A zip, as every .pptx is, holding the slides' text.
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  await context.close();
});
