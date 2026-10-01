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

// Tickets 094, 099 and 105: the composer's + menu, the model overlay, the
// thinking level and fast mode, driven by keyboard the way the Done-whens ask.

test.use({ storageState: storageStateFor("ada") });

const PARROT = /Parrot/;
const THINKING = /^Thinking:/;

const isCreateRun = (request: Request) =>
  request.method() === "POST" &&
  new URL(request.url()).pathname === "/api/runs";

/** The body of the next `POST /api/runs`, once `act` has triggered it. */
const nextRunBody = async (page: Page, act: () => Promise<void>) => {
  const request = page.waitForRequest(isCreateRun);
  await act();
  return (await request).postDataJSON() as {
    readonly options?: {
      readonly fast?: boolean;
      readonly reasoning?: string;
      readonly webSearch?: string;
    };
    readonly target?: {
      readonly model?: string;
      readonly parameters?: { readonly reasoningEffort?: string };
      readonly type: string;
    };
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
  // From the keyboard: a click leaves the pointer where the centred overlay
  // opens, and a row under the pointer takes the highlight.
  await targetPicker(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Choose a model or agent" });
  await expect(dialog).toBeVisible();
  const card = dialog.locator("[data-slot=preview-pane-content]");

  // An overlay (105): centred across the page rather than hung off the
  // button, with focus in its search.
  await expect(dialog.getByRole("combobox")).toBeFocused();
  const box = await dialog.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(
    Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - width / 2)
  ).toBeLessThan(2);

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

test("the thinking level and fast mode sit apart, and go out with the run (105)", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  // The trigger sits by Send, the thinking control just before it (once
  // the models have loaded and the chat has settled on Echo).
  const end = page.getByRole("button", { name: "Send" }).locator("..");
  await expect
    .poll(() =>
      end
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("aria-label"))
        )
    )
    .toEqual(["Thinking: Default", "Model or agent: Echo", "Send"]);

  // Echo reasons: Low goes out as the run's reasoning, not on the target.
  const thinking = page.getByRole("button", { name: THINKING });
  await thinking.click();
  await page.getByRole("menuitemradio", { name: "Low" }).click();
  await expect(thinking).toHaveAccessibleName("Thinking: Low");
  await expect(thinking).toBeFocused();
  const body = await nextRunBody(page, () => send(page, "Think a little"));
  // Echo either goes out as the target or, while the new chat's details
  // still load, is left to the chat's own default (111).
  if (body.target !== undefined) {
    expect(body.target).toEqual({ model: "mock:echo", type: "model" });
  }
  expect(body.options).toEqual({
    reasoning: "low",
    sandbox: "auto",
    webSearch: "auto",
  });
  await expectReply(page, "Echo: Think a little");

  // GPT-5.2's maker has a fast tier: Fast mode goes out as the run's fast
  // option, beside its own level.
  const dialog = page.getByRole("dialog", { name: "Choose a model or agent" });
  const pick = async (from: string, search: string) => {
    await targetPicker(page, from).click();
    await expect(dialog.getByRole("combobox")).toBeFocused();
    await page.keyboard.type(search);
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
  };
  await pick("Echo", "gpt-5.2");
  await expect(thinking).toHaveAccessibleName("Thinking: Default");
  await thinking.click();
  await page.getByRole("menuitemradio", { name: "Off" }).click();
  await plusMenu(page).click();
  await page.getByRole("menuitemcheckbox", { name: "Fast mode" }).click();
  await page.keyboard.press("Escape");
  const fastChip = page.getByRole("button", {
    name: "Fast mode is on. Turn it off",
  });
  await expect(fastChip).toBeVisible();
  const tier = await nextRunBody(page, () => send(page, "Fast and plain"));
  expect(tier.target).toEqual({ model: "mock:openai/gpt-5.2", type: "model" });
  expect(tier.options).toMatchObject({ fast: true, reasoning: "off" });
  await expectReply(page, "Echo: Fast and plain");

  // Parrot doesn't reason, and its catalog fast entry is its Fast mode.
  await pick("GPT-5.2", "parrot");
  await expect(thinking).toBeHidden();
  await expect(fastChip).toBeHidden();
  await plusMenu(page).click();
  await page.getByRole("menuitemcheckbox", { name: "Fast mode" }).click();
  await page.keyboard.press("Escape");
  await expect(fastChip).toBeVisible();
  await expect(targetPicker(page, "Parrot")).toBeVisible();
  const fast = await nextRunBody(page, () => send(page, "Quickly now"));
  expect(fast.target).toEqual({ model: "mock:parrot-fast", type: "model" });
  expect(fast.options).toBeUndefined();
  await expectReply(page, "Echo: Quickly now");

  // Back on Echo, its level is remembered.
  await pick("Parrot", "mock echo");
  await expect(targetPicker(page, "Echo")).toBeVisible();
  await expect(thinking).toHaveAccessibleName("Thinking: Low");
});
