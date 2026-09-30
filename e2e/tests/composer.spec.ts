import { expect, type Page, type Request, test } from "@playwright/test";

import {
  composer,
  composerReady,
  expectReply,
  openAttachChooser,
  plusMenu,
  send,
  targetPicker,
  userMessages,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Ticket 094: the composer's + menu and the model dialog, driven by
// keyboard the way the Done-when asks.

test.use({ storageState: storageStateFor("ada") });

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

test("the model dialog searches every option and picks by keyboard", async ({
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
  await expect(
    composer(page).getByRole("list", { name: "Attachments" })
  ).toContainText("plus-notes.txt");

  // By keyboard: open the menu, move to Web search, switch it on.
  await plusMenu(page).focus();
  await page.keyboard.press("Enter");
  const toggle = page.getByRole("menuitemcheckbox", { name: "Web search" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
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
