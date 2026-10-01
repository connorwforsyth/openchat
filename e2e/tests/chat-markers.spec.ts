import { expect, test } from "@playwright/test";

import {
  assistantMessages,
  expectReply,
  pickTarget,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Ticket 107: switching the model mid-chat puts a quiet marker in the
// conversation, before the first answer from the new model. (Agent switches
// are covered by the component tests: the server doesn't store an answer's
// agent yet, so an e2e run can't see one.)

const SWITCHED = /^Switched to /;

test.use({ storageState: storageStateFor("ada") });

test("switching model mid-chat marks the switch once", async ({ page }) => {
  await page.goto("/");
  const markers = page.getByRole("separator", { name: SWITCHED });

  await send(page, "First on echo");
  await expectReply(page, "Echo: First on echo");
  await expect(markers).toHaveCount(0);

  await pickTarget(page, { group: "mock", name: "Parrot" });
  await send(page, "Now on parrot");
  await expectReply(page, "Echo: Now on parrot");
  const toParrot = page.getByRole("separator", { name: "Switched to Parrot" });
  await expect(toParrot).toBeVisible();
  await expect(markers).toHaveCount(1);
  // Selecting the conversation to copy it skips the marker.
  await expect(toParrot).toHaveCSS("user-select", "none");
  // The marker isn't a message: still one answer per question.
  await expect(assistantMessages(page)).toHaveCount(2);

  // Same model again: no new marker.
  await send(page, "Still parrot");
  await expectReply(page, "Echo: Still parrot");
  await expect(markers).toHaveCount(1);

  // Back to echo: a switch again, so a second marker.
  await pickTarget(page, { group: "mock", name: "Echo" });
  await send(page, "Back to echo");
  await expectReply(page, "Echo: Back to echo");
  await expect(
    page.getByRole("separator", { name: "Switched to Echo" })
  ).toBeVisible();
  await expect(markers).toHaveCount(2);

  // They come from the stored messages, so a reload keeps them.
  await page.reload();
  await expect(toParrot).toBeVisible();
  await expect(markers).toHaveCount(2);
});
