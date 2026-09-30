import { cleanup, screen, within } from "@testing-library/react";
import { interruptedMessage } from "@workspace/ai/messages/approval";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { pendingEdit } from "../fixtures";
import { REPROPOSE_REASON } from "../model/approval";
import type { ToolCallPart, ToolResultPart } from "../model/parts";
import { renderWithI18n } from "../testing/render";
import {
  type ConversationActions,
  ConversationActionsProvider,
} from "./actions";
import { type RunActivity, RunActivityProvider } from "./approval-state";
import { ToolPart } from "./tool-part";

// Diffs render synchronously here (ticket 037); see conversation-view.test.
vi.mock("./lazy", () => import("../testing/sync-lazy"));

const RAN = /Ran/;
const RUNNING = /Running/;
const COULDNT_RUN = /Couldn't run/;
const EXITED = /exited with code 1/;
const USED_CREATE_ISSUE = /Used create_issue from github/;
const USED_LOOKUP = /Used lookup/;
const DECISION_SENT = /Decision sent/;
const STOPPED_BY_YOU = /Stopped by you/;

const call = (
  toolName: string,
  input: ToolCallPart["input"],
  approval: ToolCallPart["approval"] = { state: "not-required" }
): ToolCallPart => ({
  approval,
  input,
  toolCallId: `call_${toolName}`,
  toolName,
  type: "tool-call",
});

const success = (
  toolName: string,
  value: Extract<ToolResultPart["output"], { status: "success" }>["value"]
): ToolResultPart => ({
  output: { status: "success", value },
  toolCallId: `call_${toolName}`,
  toolName,
  type: "tool-result",
});

const ran = (stdout: string, exitCode = 0, stderr = "") => ({
  durationMs: 5,
  exitCode,
  status: "ran",
  stderr,
  stdout,
  timedOut: false,
  truncated: false,
});

const HASH = "b".repeat(64);
const changed = (
  path: string,
  patch: string,
  hunkIds: readonly string[],
  applied: readonly string[] = hunkIds
) => ({
  applied: [...applied],
  edit: {
    hunks: hunkIds.map((hunkId) => ({
      hunkId,
      newLines: 1,
      newStart: 1,
      oldLines: 1,
      oldStart: 1,
    })),
    patch: `--- ${path}\tsha256:${HASH}\n+++ ${path}\n${patch}`,
    path,
  },
  rejected: hunkIds.filter((id) => !applied.includes(id)),
  status: "changed",
});

const renderTool = (
  toolCall: ToolCallPart,
  result: ToolResultPart | undefined,
  actions: ConversationActions = {},
  {
    activity = { answers: new Map(), decisions: new Map() },
    running = false,
    streaming = true,
  }: {
    readonly activity?: RunActivity;
    readonly running?: boolean;
    readonly streaming?: boolean;
  } = {}
) =>
  renderWithI18n(
    <RunActivityProvider value={activity}>
      <ConversationActionsProvider actions={actions}>
        <ToolPart
          approvals={[pendingEdit]}
          call={toolCall}
          result={result}
          running={running}
          streaming={streaming}
        />
      </ConversationActionsProvider>
    </RunActivityProvider>
  );

/** The status line's toggle, found by what it says. */
const line = (name: RegExp | string) => screen.getByRole("button", { name });

const statusOf = (element: HTMLElement) =>
  element.closest("[data-status]")?.getAttribute("data-status");

afterEach(() => {
  cleanup();
});

describe("bash", () => {
  const bash = call("bash", { command: "ls -la\necho done" });

  it("shows a running line with a spinner", () => {
    renderTool(bash, undefined);
    const toggle = line(RUNNING);
    expect(toggle.textContent).toContain("ls -la…");
    expect(statusOf(toggle)).toBe("running");
    expect(toggle.querySelector(".motion-safe\\:animate-spin")).toBeTruthy();
  });

  it("says Stopped, without a spinner, once the message stopped with no result", async () => {
    renderTool(bash, undefined, {}, { streaming: false });
    const toggle = line("Stopped");
    expect(statusOf(toggle)).toBe("stopped");
    expect(toggle.className).not.toContain("text-destructive");
    expect(toggle.querySelector(".motion-safe\\:animate-spin")).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByLabelText("Command and output").textContent).toContain(
      "ls -la"
    );
  });

  it("keeps spinning while its run goes on, though this page isn't following it", () => {
    renderTool(bash, undefined, {}, { running: true, streaming: false });
    expect(statusOf(line(RUNNING))).toBe("running");
  });

  it("says who stopped it, and keeps what it had printed", async () => {
    renderTool(bash, {
      output: {
        message: interruptedMessage("user", true, "step 1\nstep 2"),
        status: "error",
      },
      toolCallId: "call_bash",
      toolName: "bash",
      type: "tool-result",
    });
    const toggle = line(RUNNING);
    expect(statusOf(toggle)).toBe("stopped");
    expect(toggle.textContent).toContain("Stopped by you");
    expect(toggle.className).not.toContain("text-destructive");
    await userEvent.click(toggle);
    expect(screen.getByLabelText("Command and output").textContent).toContain(
      "step 2"
    );
  });

  it("expands to the command and the end of its output", async () => {
    renderTool(bash, success("bash", ran("a.txt\nb.txt\n", 0, "warn: x")));
    const toggle = line(RAN);
    expect(statusOf(toggle)).toBe("done");
    expect(screen.queryByLabelText("Command and output")).toBeNull();

    await userEvent.click(toggle);
    const output = screen.getByLabelText("Command and output");
    expect(output.textContent).toContain("ls -la\necho done");
    expect(output.textContent).toContain("a.txt\nb.txt");
    expect(output.textContent).toContain("warn: x");
  });

  it("shows a failed command in the destructive colour, with why", () => {
    renderTool(bash, success("bash", ran("", 1, "no such file")));
    const toggle = line(EXITED);
    expect(statusOf(toggle)).toBe("error");
    expect(toggle.className).toContain("text-destructive");
    expect(toggle.textContent).toContain("no such file");
  });

  it("shows a tool error as an error line", () => {
    renderTool(bash, {
      output: { message: "The workspace is unavailable", status: "error" },
      toolCallId: "call_bash",
      toolName: "bash",
      type: "tool-result",
    });
    const toggle = line(COULDNT_RUN);
    expect(statusOf(toggle)).toBe("error");
    expect(toggle.textContent).toContain("The workspace is unavailable");
  });
});

describe("files", () => {
  it("reads a path", () => {
    renderTool(
      call("read", { path: "src/app.ts" }),
      success("read", {
        content: "x",
        path: "src/app.ts",
        status: "read",
        totalLines: 1,
        truncated: false,
      })
    );
    const toggle = line("Read src/app.ts");
    expect(within(toggle).getByText("src/app.ts").tagName).toBe("CODE");
  });

  it("shows a created file as a card that opens it", async () => {
    const onOpenFile = vi.fn();
    renderTool(
      call("write", { content: "a\nb\n", path: "notes.txt" }),
      success(
        "write",
        changed("notes.txt", "@@ -0,0 +1,2 @@\n+a\n+b\n", ["h1"])
      ),
      { onOpenFile }
    );
    const card = screen.getByRole("region", { name: "Created notes.txt" });
    expect(within(card).getByText("2 lines added")).toBeTruthy();
    expect(within(card).getByText("0 lines removed")).toBeTruthy();

    await userEvent.click(
      within(card).getByRole("button", { name: "Open notes.txt" })
    );
    expect(onOpenFile).toHaveBeenCalledWith("notes.txt");
  });

  it("shows an edited file with the applied hunks' counts", () => {
    renderTool(
      call("edit", { newString: "b", oldString: "a", path: "src/app.ts" }),
      success(
        "edit",
        changed(
          "src/app.ts",
          "@@ -1,2 +1,2 @@\n-a\n+b\n keep\n@@ -9,1 +9,2 @@\n-c\n+d\n+e\n",
          ["h1", "h2"],
          ["h1"]
        )
      ),
      { onOpenFile: vi.fn() }
    );
    const card = screen.getByRole("region", { name: "Edited src/app.ts" });
    expect(within(card).getByText("1 line added")).toBeTruthy();
    expect(within(card).getByText("1 line removed")).toBeTruthy();
    expect(within(card).getByText("1 change rejected")).toBeTruthy();
  });

  it("has no Open when the host can't open files", () => {
    renderTool(
      call("write", { content: "a\n", path: "notes.txt" }),
      success("write", changed("notes.txt", "@@ -0,0 +1 @@\n+a\n", ["h1"]))
    );
    screen.getByRole("region", { name: "Created notes.txt" });
    expect(screen.queryByRole("button", { name: "Open notes.txt" })).toBeNull();
  });
});

describe("other tools", () => {
  it("opens a preview in a new tab", () => {
    renderTool(
      call("preview", { port: 3000 }),
      success("preview", {
        port: 3000,
        status: "exposed",
        url: "http://localhost:4100/",
      })
    );
    line("Opened a preview");
    const open = screen.getByRole("link", { name: "Open" });
    expect(open.getAttribute("href")).toBe("http://localhost:4100/");
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("opens a preview in the app when the host can", async () => {
    const onOpenPreview = vi.fn();
    renderTool(
      call("preview", { port: 3000 }),
      success("preview", {
        port: 3000,
        status: "exposed",
        url: "http://localhost:4100/",
      }),
      { onOpenPreview }
    );
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenPreview).toHaveBeenCalledWith("http://localhost:4100/");
  });

  it("searches files and the web", () => {
    renderTool(
      call("file_search", { query: "budget" }),
      success("file_search", { results: [] })
    );
    line("Searched your files");
    cleanup();

    renderTool(call("web_search", { query: "bun" }), undefined);
    line("Searching the web");
    cleanup();

    renderTool(
      call("web_search", { query: "bun" }),
      success("web_search", { results: [], sources: [], status: "ok" })
    );
    line("Searched the web");
  });

  it("names an MCP tool and expands to its raw input and result", async () => {
    renderTool(
      call("github__create_issue", { title: "Bug" }),
      success("github__create_issue", {
        content: [{ text: "#12", type: "text" }],
      })
    );
    await userEvent.click(line(USED_CREATE_ISSUE));
    expect(screen.getByText("Parameters")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
    expect(document.body.textContent).toContain('"title": "Bug"');
  });

  it("falls back to the tool's name", () => {
    renderTool(call("lookup", {}), success("lookup", "ok"));
    expect(statusOf(line(USED_LOOKUP))).toBe("done");
  });
});

describe("approvals", () => {
  const pending = call(
    "edit",
    { path: "src/search/sync-worker.ts" },
    { requestedAt: "2026-09-29T00:00:00.000Z", state: "pending" }
  );

  it("keeps per-hunk review for a pending change", async () => {
    const onDecide = vi.fn();
    renderTool({ ...pending, toolCallId: pendingEdit.toolCallId }, undefined, {
      onDecide,
    });
    expect(statusOf(line("Wants to change src/search/sync-worker.ts"))).toBe(
      "awaiting"
    );
    expect(
      screen.getByText("The agent wants to change files.", { exact: false })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Accept change 1" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reject change 2" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Submit review" })
    );
    expect(onDecide).toHaveBeenCalledWith(pendingEdit.toolCallId, {
      comments: [],
      decision: "review",
      hunks: [
        { decision: "accept", hunkId: "h1" },
        { decision: "reject", hunkId: "h2" },
      ],
    });
    expect(await screen.findByText(DECISION_SENT)).toBeTruthy();
  });

  it("keeps a decision that's on its way across a remount", () => {
    const decided = { ...pending, toolCallId: pendingEdit.toolCallId };
    renderTool(
      decided,
      undefined,
      { onDecide: vi.fn() },
      {
        activity: {
          answers: new Map(),
          decisions: new Map([[pendingEdit.toolCallId, { status: "sending" }]]),
        },
      }
    );
    expect(screen.getByText(DECISION_SENT)).toBeTruthy();
    // The card keeps its place, inert, so a double click can't land on the
    // next card's buttons.
    expect(
      screen.getByRole("button", { name: "Approve all" }).closest("[inert]")
    ).toBeTruthy();
  });

  it("says a decision failed, and sends it again on Retry", async () => {
    const onRetry = vi.fn();
    renderTool(
      { ...pending, toolCallId: pendingEdit.toolCallId },
      undefined,
      { onDecide: vi.fn() },
      {
        activity: {
          answers: new Map(),
          decisions: new Map([
            [pendingEdit.toolCallId, { reason: "failed", status: "failed" }],
          ]),
          onRetry,
        },
      }
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "didn't reach the server"
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith(pendingEdit.toolCallId);
  });

  it("says when someone else decided first", () => {
    renderTool(
      { ...pending, toolCallId: pendingEdit.toolCallId },
      undefined,
      { onDecide: vi.fn() },
      {
        activity: {
          answers: new Map(),
          decisions: new Map([
            [pendingEdit.toolCallId, { reason: "conflict", status: "failed" }],
          ]),
        },
      }
    );
    expect(screen.getByRole("alert").textContent).toContain("already decided");
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
  });

  it("offers to ask again when the file changed since the change was proposed", async () => {
    const onDecide = vi.fn();
    renderTool(
      { ...pending, toolCallId: pendingEdit.toolCallId },
      undefined,
      { onDecide },
      {
        activity: {
          answers: new Map(),
          decisions: new Map(),
          stale: new Set([pendingEdit.toolCallId]),
        },
      }
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "changed after the agent proposed this"
    );
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Ask for an updated change" })
    );
    expect(onDecide).toHaveBeenCalledWith(pendingEdit.toolCallId, {
      decision: "reject",
      reason: REPROPOSE_REASON,
    });
  });

  it("says a change its run skipped never ran", () => {
    renderTool(
      { ...pending, toolCallId: pendingEdit.toolCallId },
      {
        output: {
          message: interruptedMessage("user", false),
          status: "error",
        },
        toolCallId: pendingEdit.toolCallId,
        toolName: "edit",
        type: "tool-result",
      },
      { onDecide: vi.fn() }
    );
    const toggle = line(STOPPED_BY_YOU);
    expect(toggle.textContent).toContain("Wants to change");
    expect(statusOf(toggle)).toBe("stopped");
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
  });

  it("shows only the line to someone who can't decide", () => {
    renderTool({ ...pending, toolCallId: pendingEdit.toolCallId }, undefined);
    line("Wants to change src/search/sync-worker.ts");
    expect(screen.queryByRole("button", { name: "Reject all" })).toBeNull();
  });
});
