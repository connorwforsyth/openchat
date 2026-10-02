import { expect, type Locator, type Page, test } from "@playwright/test";

import { apiFor } from "../support/api";
import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  openWorkspace,
  plusMenu,
  send,
  targetPicker,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Image generation (138), as a person meets it: the picker says the model
// makes images and with which image model; the + menu starts a request;
// asking for pictures waits for approval, then shows them in the reply,
// in the Files panel under images/ and on the Artifacts page; and "Edit
// this image" puts a follow-up in the composer that edits one. The image
// model is the mock's `pixel` (no real image API is ever called).

test.use({ storageState: storageStateFor("ada") });

const APPROVE = /^Approve( all)?$/;
const MADE_TWO = /Tool result: Made 2 images with Pixel\./;
const MADE_EDIT =
  /Tool result: Made 1 image with Pixel\. Saved in the workspace as images\/make-it-blue-1\.png/;
const IMAGE_ITEM = /^Image/;
const FIRST = "images/a-lighthouse-at-dusk-1.png";

/** Approves the one call the run is waiting on. */
const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

/** Whether every picture in `images` has loaded (the mock's are 1×1). */
const loaded = (images: Locator) =>
  images.evaluateAll((all) =>
    all.every(
      (image) =>
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0
    )
  );

test("the picker says which models make images, and with what", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  await targetPicker(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Choose a model or agent" });
  const card = dialog.locator("[data-slot=preview-pane-content]");
  await expect(card).toContainText("Echo");
  const before = await card.boundingBox();
  const makes = card.getByTestId("model-preview-makes-images");
  await expect(makes).toContainText("Makes images");
  await expect(makes).toContainText("with Pixel");
  // The image model itself is never offered as a chat model.
  await expect(dialog.getByRole("option", { name: "Pixel" })).toHaveCount(0);
  // The row sits inside the card, which keeps its place beside the list.
  const after = await card.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.width).toBe(before?.width);
  await page.keyboard.press("Escape");

  // The + menu's Image starts the request.
  await plusMenu(page).click();
  await page.getByRole("menuitem", { name: IMAGE_ITEM }).click();
  await expect(composer(page)).toHaveText("Make an image of ");
});

test("pictures are asked for, shown inline, kept as files and artifacts, and edited", async ({
  baseURL,
  context,
  page,
}) => {
  await page.goto("/");
  await send(
    page,
    '[tool:generate_image {"prompt": "A lighthouse at dusk", "count": 2}]'
  );
  // Images cost more than a reply: the call waits for a person.
  await expect(
    page.getByRole("button", { name: "Wants to make 2 images" })
  ).toBeVisible();
  await approve(page, "generate_image");
  await expectReply(page, MADE_TWO);
  const chat = await conversationIdOf(page);

  // Inline, each with a download.
  const made = page.getByRole("region", { name: "Generated images" });
  const pictures = made.getByRole("img");
  await expect(pictures).toHaveCount(2);
  await expect.poll(() => loaded(pictures)).toBe(true);
  await expect(
    made.getByRole("link", { name: "Download a-lighthouse-at-dusk-1.png" })
  ).toHaveAttribute("download", "a-lighthouse-at-dusk-1.png");

  // In the Files panel, under images/.
  const panel = await openWorkspace(page);
  const folder = panel.getByRole("treeitem", { name: "images" });
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") {
    await folder.click();
  }
  await expect(
    panel.getByRole("treeitem", { name: "a-lighthouse-at-dusk-1.png" })
  ).toBeVisible();
  await expect(
    panel.getByRole("treeitem", { name: "a-lighthouse-at-dusk-2.png" })
  ).toBeVisible();

  // As artifacts, on the Artifacts page.
  const api = await apiFor(context, baseURL ?? "");
  const artifacts = await api.artifacts.list({ conversationId: chat });
  expect(
    artifacts
      .filter((each) => each.kind === "image")
      .map((each) => each.title)
      .sort()
  ).toEqual(["A lighthouse at dusk (1)", "A lighthouse at dusk (2)"]);

  // Edit this image: a follow-up naming the picture, for the person to finish.
  await made.getByRole("button", { name: "Edit this image" }).first().click();
  await expect(composer(page)).toHaveText(`Edit the image ${FIRST}: `);
  await expect(composer(page)).toBeFocused();
  await composer(page).pressSequentially(
    `[tool:generate_image {"prompt": "Make it blue", "source": "${FIRST}"}]`
  );
  await composer(page).press("Enter");
  await approve(page, "generate_image");
  await expectReply(page, MADE_EDIT);
  await expect(
    panel.getByRole("treeitem", { name: "make-it-blue-1.png" })
  ).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Artifacts" }).click();
  const row = page.locator("li[data-artifact-id]").filter({
    has: page.getByRole("link", {
      exact: true,
      name: "A lighthouse at dusk (1)",
    }),
  });
  await expect(row).toBeVisible();
  await expect(row.getByRole("img", { name: "Generated image" })).toBeVisible();
  await row
    .getByRole("link", { exact: true, name: "A lighthouse at dusk (1)" })
    .click();
  // The full page shows the picture, not its source.
  const full = page.getByRole("img", { name: "A lighthouse at dusk (1)" });
  await expect(full).toBeVisible();
  await expect.poll(() => loaded(full)).toBe(true);
});
