import { expect, type Page } from "@playwright/test";
import {
  assistantMessages,
  composer,
  send,
  userMessages,
} from "../../../../e2e/support/chat";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";

// Feature: sending while the agent works (features/batch.md).

test.use({ storageState: authState("ada"), video: "on" });

/** Three quick messages, each sent with Enter as soon as it's typed. */
const sendQuickly = async (page: Page, texts: readonly string[]) => {
  const input = composer(page);
  await input.click();
  for (const text of texts) {
    // biome-ignore lint/performance/noAwaitInLoops: typed one after another, as a person would.
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }
};

test("three quick messages while the answer only writes: it restarts and answers them once", async ({
  page,
}) => {
  const tag = `r${Date.now().toString(36)}`;
  await page.goto("/");
  await send(page, `[slow] ${tag}`);
  await expect(assistantMessages(page).last()).toContainText("word2");
  await proof(page, "batch", "01-restart-writing");

  // The mock answers in milliseconds unless told `[slow]`; a model takes
  // longer, so every restarted answer is still writing when the next lands.
  const texts = [`[slow] one ${tag}`, `[slow] two ${tag}`, `three ${tag}`];
  await sendQuickly(page, texts);
  // In the thread at once, before any answer to them.
  await expect(userMessages(page)).toHaveCount(4);
  await proof(page, "batch", "02-restart-sent");

  await expect(assistantMessages(page).last()).toContainText(
    `${texts[0]} / ${texts[1]} / ${texts[2]}`,
    { timeout: 30_000 }
  );
  // One answer for all of them; the stopped one isn't shown.
  await expect(assistantMessages(page)).toHaveCount(1);
  await expect(page.getByText("Slow reply")).toHaveCount(0);
  await proof(page, "batch", "03-restart-answered");
});

test("three quick messages during tool work: taken together at the next step", async ({
  page,
}) => {
  const tag = `t${Date.now().toString(36)}`;
  await page.goto("/");
  await send(page, `[script:steady] ${tag}`);
  await expect(page.getByText("sleep 6").first()).toBeVisible({
    timeout: 15_000,
  });
  await proof(page, "batch", "04-take-tool-running");

  const texts = [`alpha ${tag}`, `beta ${tag}`, `gamma ${tag}`];
  await sendQuickly(page, texts);
  await expect(userMessages(page)).toHaveCount(4);
  await proof(page, "batch", "05-take-sent");

  await expect(assistantMessages(page).last()).toContainText(
    `${texts[0]} / ${texts[1]} / ${texts[2]}`,
    { timeout: 30_000 }
  );
  // The tool step's answer, then one answer to the batch.
  await expect(assistantMessages(page)).toHaveCount(2);
  await proof(page, "batch", "06-take-answered");

  await page.reload();
  await expect(userMessages(page)).toHaveCount(4);
  await expect(assistantMessages(page)).toHaveCount(2);
  await proof(page, "batch", "07-take-after-reload");
});
