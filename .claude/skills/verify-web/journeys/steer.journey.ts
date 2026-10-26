import { expect } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import {
  assistantMessages,
  composer,
  conversationIdOf,
  send,
  userMessages,
} from "../../../../e2e/support/chat";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";

// Feature: steer (features/steer.md). The composer takes messages while an
// answer streams: Enter queues the next turn, Mod+Enter steers. The mock
// model answers one step per turn, so a steer here has no step boundary to
// join and runs as the next turn; a real model's multi-step answer takes it
// (packages/server/src/runs/steer.runs.test.ts covers the take).

test.use({ storageState: authState("ada") });

test("messages sent while an answer streams queue, show over the composer, and stream in turn", async ({
  baseURL,
  page,
}) => {
  const tag = `s${Date.now().toString(36)}`;
  await page.goto("/");
  await send(page, `[slow] ${tag}`);
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  const input = composer(page);
  await input.click();
  await page.keyboard.type(`Steer ${tag}`);
  await expect(page.getByRole("button", { name: "Steer" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type(`Queued ${tag}`);
  await page.keyboard.press("Enter");

  const tray = page.getByTestId("queue-tray");
  await expect(tray.getByText(`Steer ${tag}`)).toBeVisible();
  await expect(tray.getByText(`Queued ${tag}`)).toBeVisible();
  // Waiting turns show in the queue, not the transcript.
  await expect(userMessages(page)).toHaveCount(1);
  await proof(page, "steer", "01-queue-over-composer");

  // A second tab reads the same queue from the server.
  const other = await page.context().newPage();
  await other.goto(page.url());
  await expect(
    other.getByTestId("queue-tray").getByText(`Queued ${tag}`)
  ).toBeVisible();
  await proof(other, "steer", "02-second-tab-queue");
  await other.close();

  // Each queued turn's answer streams on this page as its run starts,
  // without a reload.
  await expect(assistantMessages(page).last()).toContainText(
    `Echo: Queued ${tag}`,
    { timeout: 60_000 }
  );
  await expect(tray).toHaveCount(0);
  await expect(userMessages(page)).toHaveCount(3);
  await proof(page, "steer", "03-turns-answered-in-order");

  const id = await conversationIdOf(page);
  const api = await apiFor(page, baseURL ?? "");
  const runs = await api.runs.list({ conversationId: id, limit: 10 });
  expect(runs.items.map((run) => run.state.status)).toEqual([
    "succeeded",
    "succeeded",
    "succeeded",
  ]);
});

test("a queued message can be taken back to edit, or removed", async ({
  page,
}) => {
  const tag = `e${Date.now().toString(36)}`;
  await page.goto("/");
  await send(page, `[slow] ${tag}`);
  const input = composer(page);
  await input.click();
  await page.keyboard.type(`Edit me ${tag}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Drop me ${tag}`);
  await page.keyboard.press("Enter");
  const tray = page.getByTestId("queue-tray");
  await expect(tray.getByText(`Drop me ${tag}`)).toBeVisible();

  await tray
    .locator("li", { hasText: `Drop me ${tag}` })
    .getByRole("button", { name: "Remove from the queue" })
    .click();
  await expect(tray.getByText(`Drop me ${tag}`)).toHaveCount(0);

  await tray
    .locator("li", { hasText: `Edit me ${tag}` })
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(input).toHaveText(`Edit me ${tag}`);
  await expect(tray).toHaveCount(0);
  await proof(page, "steer", "04-edit-back-in-composer");

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(userMessages(page)).toHaveCount(1);
});
