import { expect, type Page, type Request, test } from "@playwright/test";

import {
  composerReady,
  expectReply,
  openAttachChooser,
  plusMenu,
  send,
  targetPicker,
  userMessages,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Tickets 094 and 099: the composer's + menu and the model panel, driven
// by keyboard the way the Done-whens ask.

test.use({ storageState: storageStateFor("ada") });

const PARROT = /Parrot/;

const isCreateRun = (request: Request) =>
  request.method() === "POST" &&
  new URL(request.url()).pathname === "/api/runs";

/** The body of the next `POST /api/runs`, once `act` has triggered it. */
const nextRunBody = async (page: Page, act: () => Promise<void>) => {
  const request = page.waitForRequest(isCreateRun);
  await act();
  return (await request).postDataJSON() as {
    readonly options?: { readonly webSearch?: string };
    readonly target?: { readonly model?: string; readonly type: string };
  };
};

test("the model panel searches every option and picks by keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  const trigger = targetPicker(page);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose a model or agent" });
  await expect(dialog).toBeVisible();

  // Sections per provider; a model with no key here stays, disabled, saying why.
  const paid = dialog.getByRole("group", { name: "paid" });
  await expect(paid.getByRole("option")).toHaveAttribute(
    "aria-disabled",
    "true"
  );
  await expect(paid).toContainText("No key in this context");

  // Search narrows to the one provider's model; Enter picks it.
  await page.keyboard.type("mock echo");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(targetPicker(page, "echo")).toBeFocused();

  // Escape closes without changing anything, back on the button.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(targetPicker(page, "echo")).toBeFocused();

  const body = await nextRunBody(page, () =>
    send(page, "Picked from the dialog")
  );
  expect(body.target).toEqual({ model: "mock:echo", type: "model" });
  await expectReply(page, "Echo: Picked from the dialog");
});

test("the panel's card follows the highlighted model, which picks and sends", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  await targetPicker(page).click();
  const dialog = page.getByRole("dialog", { name: "Choose a model or agent" });
  await expect(dialog).toBeVisible();
  const card = dialog.locator("[data-slot=preview-pane-content]");

  // It opens on the current model, named from the catalog without its
  // provider, the provider at the row's end and its logo beside it.
  const mock = dialog.getByRole("group", { name: "mock" });
  await expect(mock.getByRole("option", { name: "Echo" })).toContainText(
    "mock"
  );
  await expect(card).toContainText("Echo");
  await expect(card).toContainText("128K tokens");
  await expect(card.getByRole("meter", { name: "Cost" })).toBeAttached();
  await expect(card).toContainText("Tool use");

  // Down moves to the catalog's other model; the card follows it, and says
  // there's nothing to rate it by.
  await page.keyboard.press("ArrowDown");
  await expect(card).toContainText("Parrot");
  await expect(card).toContainText("32K tokens");
  await expect(card).toContainText("No ratings or prices for Parrot");

  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(targetPicker(page, "Parrot")).toBeFocused();
  const body = await nextRunBody(page, () => send(page, "Picked Parrot"));
  expect(body.target).toEqual({ model: "mock:parrot", type: "model" });
  await expectReply(page, "Echo: Picked Parrot");

  // It's remembered: the next opening lists it first, under Recently used.
  await targetPicker(page, "Parrot").click();
  await expect(
    dialog.getByRole("group", { name: "Recently used" }).getByRole("option")
  ).toHaveText([PARROT]);
  await page.keyboard.press("Escape");
});

test("the + menu attaches a file and switches web search on for the turn", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);

  const chooser = await openAttachChooser(page);
  await chooser.setFiles({
    buffer: Buffer.from("plus-menu-notes\n"),
    mimeType: "text/plain",
    name: "plus-notes.txt",
  });
  await expect(page.getByRole("list", { name: "Attachments" })).toContainText(
    "plus-notes.txt"
  );

  // By keyboard: open the menu, move to Web search, switch it on.
  await plusMenu(page).focus();
  await page.keyboard.press("Enter");
  const toggle = page.getByRole("menuitemcheckbox", { name: "Web search" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // Opened from the keyboard, the menu starts on its first item.
  await expect(
    page.getByRole("menuitem", { name: "Attach files" })
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(plusMenu(page)).toBeFocused();
  const chip = page.getByRole("button", {
    name: "Web search is on. Turn it off",
  });
  await expect(chip).toBeVisible();

  const body = await nextRunBody(page, () => send(page, "Search this"));
  expect(body.options?.webSearch).toBe("on");
  await expectReply(page, "Echo: Search this");
  await expect(userMessages(page).first()).toContainText("plus-notes.txt");

  // Off from its chip; the next turn goes back to the default.
  await chip.click();
  await expect(chip).toBeHidden();
  await expect(plusMenu(page)).toBeFocused();
  const second = await nextRunBody(page, () => send(page, "No search now"));
  expect(second.options).toBeUndefined();
  await expectReply(page, "Echo: No search now");
});
