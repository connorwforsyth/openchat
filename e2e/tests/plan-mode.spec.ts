import { expect, type Page, test } from "@playwright/test";

import { apiFor, eventually } from "../support/api";
import {
  composerReady,
  conversationIdOf,
  expectReply,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Plan mode as a person meets it (106): switch Plan on, get a plan back as
// the answer and as a "Plan: …" artifact, edit it in the panel, approve it,
// and the build that follows is a normal run whose file changes still ask.
// The mock answers a planning run with `ls` and then `PLAN_REPLY`, and a run
// carrying an approved plan with a `write` of it (support/mock-llm.ts).

test.use({ storageState: storageStateFor("ada") });

const PLAN_ITEM = /^Plan/;
const PLAN_ON = "Plan mode is on. Turn it off";
const PLAN_TITLE = "Plan: Write a greeting";
const GOAL = "The workspace has a greeting file.";
const EDIT = "Also: say hi in Welsh.";
const BUILT = "Built the plan.";

const planOn = async (page: Page) => {
  await composerReady(page);
  await page.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("menuitemcheckbox", { name: PLAN_ITEM }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: PLAN_ON })).toBeVisible();
};

test("Plan on, a plan and its artifact, Edit, Approve: a normal run that asks before writing", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await planOn(page);
  await send(page, "Plan a greeting file");

  // The answer is the plan, with its card.
  await expectReply(page, GOAL);
  const card = page.getByRole("region", { name: PLAN_TITLE });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Waiting for your approval");

  const api = await apiFor(page, baseURL ?? "");
  const id = await conversationIdOf(page);
  const [planning] = (await api.runs.list({ conversationId: id, limit: 5 }))
    .items;
  expect(planning?.options?.mode).toBe("plan");
  // It read (`ls`, allowed), and was offered nothing that writes.
  const path = await api.messages.path({ conversationId: id });
  const calls = path.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool-call" ? [part.toolName] : []
    )
  );
  expect(calls).toEqual(["bash"]);
  // The plan is an artifact of the chat too.
  const [artifact] = await api.artifacts.list({ conversationId: id });
  expect(artifact).toMatchObject({ kind: "markdown", title: PLAN_TITLE });

  // Edit opens it in the panel's editor.
  await card.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Plan, in Markdown" });
  await expect(editor).toBeVisible();
  const original = await editor.inputValue();
  expect(original).toContain(GOAL);
  await editor.fill(`${original}\n\n${EDIT}`);
  await page.getByRole("button", { name: "Approve the plan" }).click();

  // Approving turned Plan off and started a normal run, whose write asks.
  await expect(page.getByRole("button", { name: PLAN_ON })).toHaveCount(0);
  const approval = page
    .locator('section[aria-label^="Approval needed"]')
    .first();
  await expect(approval).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Approved");
  await expect(page.locator(".is-user[data-message-id]").last()).toContainText(
    "Approved the plan"
  );

  const building = await eventually(
    async () =>
      (await api.runs.list({ conversationId: id, limit: 5 })).items[0],
    (latest) => latest?.state.status === "awaiting_approval"
  );
  expect(building?.options?.mode).toBeUndefined();
  const pending =
    building?.state.status === "awaiting_approval"
      ? building.state.approvals
      : [];
  expect(pending.map((call) => call.toolName)).toEqual(["write"]);
  // It builds the plan as edited, saved first as the plan's next version.
  expect(JSON.stringify(pending[0]?.input)).toContain(EDIT);
  const versions = await api.artifacts.listVersions({
    id: artifact?.id ?? "",
  });
  expect(versions).toHaveLength(2);
  expect(versions[1]?.content).toContain(EDIT);

  await approval.getByRole("button", { name: "Approve" }).click();
  await expectReply(page, BUILT);
});
