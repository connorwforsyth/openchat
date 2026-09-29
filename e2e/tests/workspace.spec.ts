import { expect, type Page, test } from "@playwright/test";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { openAccountMenu } from "../support/admin";
import { apiFor, eventually } from "../support/api";
import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  openWorkspace,
  send,
} from "../support/chat";
import { storageStateFor, users } from "../support/users";

const BASH_RESULT = /Tool result: .*from-the-agent/;
const HI_RESULT = /Tool result: .*hi/;
const REVIEW_RESULT = /Tool result: .*Keep the last line as a number/;
const RAN_LS = /^Ran ls/;
const APPROVE = /^Approve/;
const SAVED = /Saved/;
const DARK = /\bdark\b/;
const LIGHT = /\blight\b/;
/** A workspace listing (`sandbox.listFiles`), batched or not. */
const LISTING = /\/sandboxes\/[^/\s"]+\/files/;

// The chat's workspace (PLAN.md D7, §11 M1 steps 6 and 7 without Docker):
// every chat has one, made on first use (056) on just-bash here, shown in
// the Workspace panel (060: files, an editor, no terminal) and reachable
// from the composer (061, 062): `@` mentions files, attachments land in it,
// `/new-file` makes one. A file change the agent proposes is reviewed hunk
// by hunk (only accepted hunks land; the agent hears about the rejected
// one). The Docker leg (a dev server and its preview, `runsc`) needs
// Docker: see the sandbox job in ci.yml.

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("ada") });

/** The chat the bash and review tests share. */
let shellChat: ConversationId;
/** The chat the file tests share: `hello.md` lives here. */
let filesChat: ConversationId;

/** The panel's editor, typed into as a person would (060). */
const editorIn = (page: Page) =>
  page.locator('[data-slot="code-editor"] [contenteditable="true"]');

/** Picks a theme from the account menu, as a person switches it. */
const pickTheme = async (page: Page, theme: "Dark" | "Light" | "System") => {
  await openAccountMenu(page, users.ada.name);
  await page.getByRole("menuitemradio", { name: theme }).click();
  await page.keyboard.press("Escape");
};

/**
 * How the editor's text reads against its background: the lowest WCAG
 * contrast ratio over every token on screen, and the colour scheme its
 * shadow root renders in. Colours are composited on a canvas, so a nearly
 * transparent token (064's placeholder colours) counts as the background.
 */
const editorLegibility = (page: Page) =>
  page.locator('[data-slot="code-editor"] diffs-container').evaluate((host) => {
    const pre = host.shadowRoot?.querySelector("pre");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!(pre && context)) {
      return { contrast: 0, scheme: "", tokens: 0 };
    }
    const paint = (colors: string[]) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of ["#fff", ...colors]) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
      const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.040_45
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const background = getComputedStyle(pre).backgroundColor;
    const behind = paint([background]);
    const tokens = [...pre.querySelectorAll("[data-line] span")].filter(
      (token) => token.textContent?.trim()
    );
    const ratios = tokens.map((token) => {
      const front = paint([background, getComputedStyle(token).color]);
      const [light, dark] = front > behind ? [front, behind] : [behind, front];
      return (light + 0.05) / (dark + 0.05);
    });
    return {
      contrast: Math.min(...ratios),
      scheme: getComputedStyle(pre).colorScheme,
      tokens: tokens.length,
    };
  });

// Large-text AA. The muted tokens (comments) sit near 4.5; 064's invisible
// text measured about 1.
const LEGIBLE = 3;

/** Waits for the editor to read in `scheme`; a failure shows the measurement. */
const expectLegible = (page: Page, scheme: "dark" | "light") =>
  expect
    .poll(
      async () => {
        const measured = await editorLegibility(page);
        return measured.scheme === scheme && measured.contrast > LEGIBLE
          ? "legible"
          : measured;
      },
      { message: `the editor's text reads in ${scheme}` }
    )
    .toBe("legible");

test("the agent's commands show as quiet lines, and the panel has files but no terminal", async ({
  page,
}) => {
  await page.goto("/");
  await send(
    page,
    '[tool:bash {"command": "ls && echo hi > a.txt && cat a.txt"}]'
  );
  await expectReply(page, HI_RESULT);
  shellChat = await conversationIdOf(page);
  await expect(page.getByRole("button", { name: RAN_LS })).toBeVisible();

  const panel = await openWorkspace(page);
  await expect(panel.getByRole("treeitem", { name: "a.txt" })).toBeVisible();
  await expect(page.getByText("Terminal")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Create sandbox" })
  ).toHaveCount(0);

  // The panel stays open across a reload and mounts before the chat's
  // workspace has loaded; it must still find it (046).
  await page.reload();
  const reopened = page.getByRole("region", { name: "Workspace" });
  await expect(reopened.getByRole("treeitem", { name: "a.txt" })).toBeVisible();
});

test("the agent runs bash in the chat's workspace", async ({ page }) => {
  await page.goto(`/c/${shellChat}`);
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
  const lines = Array.from({ length: 20 }, (_, index) => String(index + 1));
  await api.sandbox.writeFile({
    content: `${lines.join("\n")}\n`,
    conversationId: shellChat,
    encoding: "utf8",
    path: "notes.txt",
  });
  const sandbox = await api.sandbox.get({ conversationId: shellChat });
  if (!sandbox) {
    throw new Error("the chat has no workspace");
  }
  // Two changes far enough apart to be two hunks: line 1 and line 20.
  const proposed = ["one", ...lines.slice(1, 19), "twenty"].join("\\n");

  await page.goto(`/c/${shellChat}`);
  await send(
    page,
    `[tool:write {"path": "notes.txt", "content": "${proposed}\\n"}]`
  );
  await expect(
    page.getByText("The agent wants to change files.")
  ).toBeVisible();

  const waiting = await eventually(
    () => api.runs.list({ active: true, conversationId: shellChat, limit: 5 }),
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

test("a file the agent writes shows as a card; Open shows it in the tree and the editor", async ({
  page,
}) => {
  await page.goto("/");
  await send(
    page,
    '[tool:write {"path": "hello.md", "content": "hello-from-the-agent\\n"}]'
  );
  await page.getByRole("button", { name: APPROVE }).click();
  const card = page.getByRole("region", { name: "Created hello.md" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  filesChat = await conversationIdOf(page);

  await card.getByRole("button", { name: "Open hello.md" }).click();
  const panel = page.getByRole("region", { name: "Workspace" });
  await expect(
    panel.getByRole("treeitem", { name: "hello.md" })
  ).toHaveAttribute("aria-selected", "true");
  await expect(editorIn(page)).toContainText("hello-from-the-agent");
});

test("an edit typed in the panel's editor survives a reload", async ({
  baseURL,
  page,
}) => {
  await page.goto(`/c/${filesChat}`);
  const panel = await openWorkspace(page);
  await panel.getByRole("treeitem", { name: "hello.md" }).click();
  const editor = editorIn(page);
  await expect(editor).toContainText("hello-from-the-agent");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("edited-by-hand");
  await expect(panel.getByText(SAVED)).toBeVisible();

  await page.reload();
  const reopened = page.getByRole("region", { name: "Workspace" });
  await reopened.getByRole("treeitem", { name: "hello.md" }).click();
  await expect(editorIn(page)).toContainText("edited-by-hand");

  const api = await apiFor(page, baseURL ?? "");
  const sandbox = await api.sandbox.get({ conversationId: filesChat });
  if (!sandbox) {
    throw new Error("the chat has no workspace");
  }
  const file = await api.sandbox.readFile({ id: sandbox.id, path: "hello.md" });
  expect(file.content).toContain("edited-by-hand");
});

test("@hello.md puts the file's content in front of the model", async ({
  page,
}) => {
  // The `@` list reads the workspace listing, which can land after the last
  // keystroke (065). Hold it until the query is typed, so the open menu has
  // to pick it up then, with no retyping.
  let held = 0;
  let release: () => void = () => undefined;
  const listed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const sent = decodeURIComponent(
      `${request.url()} ${request.postData() ?? ""}`
    );
    if (LISTING.test(sent)) {
      held += 1;
      await listed;
    }
    await route.fallback();
  });

  await page.goto(`/c/${filesChat}`);
  const input = composer(page);
  await composerReady(page);
  await input.click();
  await input.pressSequentially("What is in @hello");
  await expect.poll(() => held).toBeGreaterThan(0);
  await expect(page.getByRole("option", { name: "hello.md" })).toBeHidden();
  release();
  await expect(page.getByRole("option", { name: "hello.md" })).toBeVisible();
  await input.press("Enter");
  await input.pressSequentially(" now");
  await input.press("Enter");
  // The mock echoes the files the server read into the turn (056), as they
  // are now: with the edit typed in the panel.
  await expectReply(page, "[hello.md: hello-from-the-agent");
  await expectReply(page, "edited-by-hand]");
});

test("a file attached in the composer lands in the workspace", async ({
  page,
}) => {
  await page.goto(`/c/${filesChat}`);
  await composerReady(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles({
    buffer: Buffer.from("attached-content\n"),
    mimeType: "text/plain",
    name: "attached-notes.txt",
  });
  await send(page, "Here are my notes");
  // Mentioned as it went in, so the turn read it too.
  await expectReply(page, "[attached-notes.txt: attached-content]");

  const panel = await openWorkspace(page);
  await expect(
    panel.getByRole("treeitem", { name: "attached-notes.txt" })
  ).toBeVisible();
});

test("/new-file creates a file and opens it", async ({ baseURL, page }) => {
  await page.goto(`/c/${filesChat}`);
  const input = composer(page);
  await composerReady(page);
  await input.click();
  await input.pressSequentially("/new-file");
  await expect(page.getByRole("option", { name: "New file" })).toBeVisible();
  await input.press("Enter");

  const dialog = page.getByRole("dialog", { name: "New file" });
  await dialog.getByLabel("Name").fill("todo.md");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();

  const panel = page.getByRole("region", { name: "Workspace" });
  await expect(
    panel.getByRole("treeitem", { name: "todo.md" })
  ).toHaveAttribute("aria-selected", "true");
  await expect(editorIn(page)).toBeVisible();
  // A command, not a message.
  await expect(input).toHaveText("");

  const api = await apiFor(page, baseURL ?? "");
  const sandbox = await api.sandbox.get({ conversationId: filesChat });
  if (!sandbox) {
    throw new Error("the chat has no workspace");
  }
  const listed = await api.sandbox.listFiles({
    id: sandbox.id,
    path: ".",
    recursive: true,
  });
  expect(listed.map((entry) => entry.path)).toContain("/work/todo.md");
});

test("the editor stays legible while the theme switches under an open file", async ({
  page,
}) => {
  await page.goto(`/c/${filesChat}`);
  const panel = await openWorkspace(page);
  await panel.getByRole("treeitem", { name: "hello.md" }).click();
  const editor = editorIn(page);
  await expect(editor).toContainText("edited-by-hand");

  await pickTheme(page, "Dark");
  await expect(page.locator("html")).toHaveClass(DARK);
  // A line the editor tokenizes itself, not the first render's highlighting.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\ntyped-in-dark");
  await expect(editor).toContainText("typed-in-dark");
  await expectLegible(page, "dark");

  // Dark to light with the file open: the switch 064 lost the text on.
  await pickTheme(page, "Light");
  await expect(page.locator("html")).toHaveClass(LIGHT);
  await expectLegible(page, "light");

  // System follows the device's preference, live.
  await page.emulateMedia({ colorScheme: "dark" });
  await pickTheme(page, "System");
  await expect(page.locator("html")).toHaveClass(DARK);
  await expectLegible(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(LIGHT);
  await expectLegible(page, "light");
});
