import { expect, type Page, test } from "@playwright/test";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { apiFor, eventually } from "../support/api";
import {
  conversationIdOf,
  expectReply,
  openWorkspace,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

const BASH_RESULT = /Tool result: .*from-the-agent/;
const REVIEW_RESULT = /Tool result: .*Keep the last line as a number/;

// PLAN.md §11 M1 steps 6 and 7 without Docker: a just-bash sandbox runs
// commands from the panel and from the agent, and a file change the agent
// proposes is reviewed hunk by hunk (only accepted hunks land; the agent
// hears about the rejected one). The Docker leg (a dev server and its
// preview, `runsc`) needs Docker: see the sandbox job in ci.yml.

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("ada") });

let conversationId: ConversationId;

const openSandbox = async (page: Page) => {
  await openWorkspace(page, "Sandbox");
  return page.getByRole("region", { name: "Sandbox" });
};

test("just-bash: the panel runs `ls && echo hi > a.txt && cat a.txt`", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "A chat with a sandbox");
  await expectReply(page, "Echo: A chat with a sandbox");
  conversationId = await conversationIdOf(page);

  const panel = await openSandbox(page);
  await panel.getByRole("button", { name: "Create sandbox" }).click();
  const command = panel.getByRole("textbox", { name: "Command" });
  await expect(command).toBeEnabled();
  await command.fill("ls && echo hi > a.txt && cat a.txt");
  await command.press("Enter");
  await expect(panel.getByLabel("Sandbox output")).toContainText("hi");

  await panel.getByRole("tab", { name: "Files" }).click();
  await expect(panel.getByRole("treeitem", { name: "a.txt" })).toBeVisible();

  // The panel stays open across a reload and mounts before the chat's
  // sandbox has loaded; it must still find it (046).
  await page.reload();
  const reopened = page.getByRole("region", { name: "Sandbox" });
  await expect(reopened.getByRole("tab", { name: "Terminal" })).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "Create sandbox" })
  ).toBeHidden();
});

test("the agent runs bash in the chat's sandbox", async ({ page }) => {
  await page.goto(`/c/${conversationId}`);
  await send(
    page,
    '[tool:bash {"command": "echo from-the-agent > b.txt && cat a.txt b.txt"}]'
  );
  await expectReply(page, BASH_RESULT);
});

test("per-hunk review: a rejected hunk stays unapplied and the agent is told", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  const sandbox = await api.sandbox.get({ conversationId });
  if (!sandbox) {
    throw new Error("the chat has no sandbox");
  }
  const lines = Array.from({ length: 20 }, (_, index) => String(index + 1));
  await api.sandbox.exec({
    command: `printf '${lines.join("\\n")}\\n' > notes.txt`,
    id: sandbox.id,
  });
  // Two changes far enough apart to be two hunks: line 1 and line 20.
  const proposed = ["one", ...lines.slice(1, 19), "twenty"].join("\\n");

  await page.goto(`/c/${conversationId}`);
  await send(
    page,
    `[tool:write {"path": "notes.txt", "content": "${proposed}\\n"}]`
  );
  await expect(
    page.getByText("The agent wants to change files.")
  ).toBeVisible();

  const waiting = await eventually(
    () => api.runs.list({ active: true, conversationId, limit: 5 }),
    (runs) =>
      runs.items.some((each) => each.state.status === "awaiting_approval")
  );
  const run = waiting.items.find(
    (each) => each.state.status === "awaiting_approval"
  );
  if (run?.state.status !== "awaiting_approval") {
    throw new Error("no run is waiting for approval");
  }
  const [approval] = run.state.approvals;
  const hunks = approval?.edits?.[0]?.hunks ?? [];
  expect(hunks).toHaveLength(2);
  const [first, last] = hunks;
  if (!(approval && first && last)) {
    throw new Error("the edit has no hunks to review");
  }
  await api.runs.submitApprovals({
    decisions: [
      {
        decision: {
          comments: [],
          decision: "review",
          hunks: [
            { decision: "accept", hunkId: first.hunkId },
            {
              comment: "Keep the last line as a number.",
              decision: "reject",
              hunkId: last.hunkId,
            },
          ],
        },
        toolCallId: approval.toolCallId,
      },
    ],
    runId: run.id,
  });

  const settled = await eventually(
    () => api.runs.get({ id: run.id }),
    (current) =>
      ["succeeded", "failed", "cancelled"].includes(current.state.status)
  );
  expect(settled.state.status).toBe("succeeded");
  const file = await api.sandbox.readFile({
    id: sandbox.id,
    path: "notes.txt",
  });
  expect(file.content.split("\n")[0]).toBe("one");
  expect(file.content.trimEnd().split("\n").at(-1)).toBe("20");

  // The agent's next step saw the rejection and the reviewer's comment.
  await page.reload();
  await expectReply(page, REVIEW_RESULT);
});
