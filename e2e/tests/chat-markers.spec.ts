import { expect, test } from "@playwright/test";

import { apiFor } from "../support/api";
import {
  assistantMessages,
  expectReply,
  pickTarget,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Ticket 107: switching the model or the agent mid-chat puts a quiet marker
// in the conversation, before the first answer from the new one.

const SWITCHED = /^Switched to /;

test.use({ storageState: storageStateFor("ada") });

test("switching model, then agent, mid-chat marks each switch once", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page.context(), baseURL ?? "");
  const agent = await api.library.create({
    definition: {
      instructions: "Answer briefly.",
      kind: "agent",
      model: "mock:echo",
    },
    description: "Keeps it short",
    name: "Marker agent",
  });
  await api.library.publishVersion({ id: agent.id });

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

  // An agent on another model: the agent's name leads.
  await pickTarget(page, { group: "My agents", name: "Marker agent" });
  await send(page, "Over to the agent");
  await expectReply(page, "Echo: Over to the agent");
  await expect(
    page.getByRole("separator", { name: "Switched to Marker agent with Echo" })
  ).toBeVisible();
  await expect(markers).toHaveCount(2);

  // They come from the stored messages, so a reload keeps them.
  await page.reload();
  await expect(toParrot).toBeVisible();
  await expect(markers).toHaveCount(2);
});
