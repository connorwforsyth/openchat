import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import type { ToolCallPart, ToolResultPart } from "./parts";
import {
  COMMAND_MAX_CHARS,
  OUTPUT_TAIL_LINES,
  outputTail,
  patchStats,
  shortCommand,
  type ToolSummary,
  toolSummary,
} from "./tool-summary";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const text = (summary: ToolSummary) => i18n._(summary.label);

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

const failure = (toolName: string, message: string): ToolResultPart => ({
  output: { message, status: "error" },
  toolCallId: `call_${toolName}`,
  toolName,
  type: "tool-result",
});

const denied = (toolName: string): ToolResultPart => ({
  output: { decision: { decision: "reject" }, status: "denied" },
  toolCallId: `call_${toolName}`,
  toolName,
  type: "tool-result",
});

const ran = (stdout: string, exitCode = 0, stderr = "") => ({
  durationMs: 12,
  exitCode,
  status: "ran",
  stderr,
  stdout,
  timedOut: false,
  truncated: false,
});

// A patch as the sandbox writes it: the `---` header stamped with the base
// file's hash (ticket 056).
const HASH = "a".repeat(64);
const createdPatch = [
  `--- notes.txt\tsha256:${HASH}`,
  "+++ notes.txt",
  "@@ -0,0 +1,3 @@",
  "+one",
  "+two",
  "+three",
  "",
].join("\n");
const editedPatch = [
  `--- src/app.ts\tsha256:${HASH}`,
  "+++ src/app.ts",
  "@@ -1,3 +1,4 @@",
  " keep",
  "-old",
  "+new",
  "+added",
  " keep",
  "@@ -10,3 +11,2 @@",
  " keep",
  "---removed line that looks like a header",
  " keep",
  "",
].join("\n");

describe("shortCommand", () => {
  it("keeps a short one-line command as it is", () => {
    expect(shortCommand("ls -la")).toBe("ls -la");
  });

  it("cuts a long command to fit", () => {
    const cut = shortCommand("x".repeat(100));
    expect(cut).toHaveLength(COMMAND_MAX_CHARS);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("shows only the first line of a script", () => {
    expect(shortCommand("cd app\nbun test")).toBe("cd app…");
  });
});

describe("outputTail", () => {
  it("keeps the last lines", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index}`);
    const tail = outputTail(lines.join("\n")).split("\n");
    expect(tail).toHaveLength(OUTPUT_TAIL_LINES);
    expect(tail.at(-1)).toBe("line 49");
  });
});

describe("patchStats", () => {
  it("counts hunk lines, not the headers, and spots a created file", () => {
    expect(patchStats(createdPatch)).toEqual({
      created: true,
      hunks: [{ added: 3, removed: 0 }],
    });
    expect(patchStats(editedPatch)).toEqual({
      created: false,
      hunks: [
        { added: 2, removed: 1 },
        { added: 0, removed: 1 },
      ],
    });
  });
});

describe("toolSummary: bash", () => {
  const bash = call("bash", { command: "ls -la" });

  it("is running until the result lands", () => {
    const summary = toolSummary(bash, undefined);
    expect(summary.status).toBe("running");
    expect(summary.icon).toBe("TerminalIcon");
    expect(text(summary)).toBe("Running ls -la");
    expect(summary.label.values).toEqual({ code: "ls -la" });
  });

  it("says what ran, with the end of its output", () => {
    const summary = toolSummary(bash, success("bash", ran("a.txt\nb.txt\n")));
    expect(summary.status).toBe("done");
    expect(text(summary)).toBe("Ran ls -la");
    expect(summary.detail).toEqual({
      command: "ls -la",
      kind: "bash",
      stderr: "",
      stdout: "a.txt\nb.txt",
    });
  });

  it("is an error when the command fails", () => {
    const summary = toolSummary(
      bash,
      success("bash", ran("", 2, "ls: cannot access 'x'"))
    );
    expect(summary.status).toBe("error");
    expect(text(summary)).toBe("ls -la exited with code 2");
    expect(summary.errorText).toBe("ls: cannot access 'x'");
  });

  it("is an error when the workspace can't run it", () => {
    const summary = toolSummary(
      bash,
      success("bash", {
        message: "The workspace is unavailable",
        status: "error",
      })
    );
    expect(summary.status).toBe("error");
    expect(text(summary)).toBe("Couldn't run ls -la");
    expect(summary.errorText).toBe("The workspace is unavailable");
  });

  it("waits on approval, and says when it was rejected", () => {
    const pending = call(
      "bash",
      { command: "rm -rf build" },
      { requestedAt: "2026-09-29T00:00:00.000Z", state: "pending" }
    );
    expect(toolSummary(pending, undefined).status).toBe("awaiting");
    expect(text(toolSummary(pending, undefined))).toBe(
      "Wants to run rm -rf build"
    );
    const rejected = toolSummary(pending, denied("bash"));
    expect(rejected.status).toBe("denied");
    expect(text(rejected)).toBe("Didn't run rm -rf build");
  });
});

describe("toolSummary: files", () => {
  it("reads a path", () => {
    const summary = toolSummary(
      call("read", { path: "src/app.ts" }),
      success("read", {
        content: "x",
        path: "src/app.ts",
        status: "read",
        totalLines: 1,
        truncated: false,
      })
    );
    expect(summary.icon).toBe("FileTextIcon");
    expect(text(summary)).toBe("Read src/app.ts");
    expect(summary.detail.kind).toBe("raw");
  });

  it("reports a created file with its line count", () => {
    const summary = toolSummary(
      call("write", { content: "one\ntwo\nthree\n", path: "notes.txt" }),
      success("write", {
        applied: ["h1"],
        edit: {
          hunks: [
            {
              hunkId: "h1",
              newLines: 3,
              newStart: 1,
              oldLines: 0,
              oldStart: 0,
            },
          ],
          patch: createdPatch,
          path: "notes.txt",
        },
        rejected: [],
        status: "changed",
      })
    );
    expect(summary.status).toBe("done");
    expect(text(summary)).toBe("Created notes.txt");
    expect(summary.detail).toEqual({
      change: {
        added: 3,
        change: "created",
        path: "notes.txt",
        rejected: 0,
        removed: 0,
      },
      kind: "file-change",
    });
  });

  it("counts only the hunks that were applied to an edited file", () => {
    const summary = toolSummary(
      call("edit", { newString: "new", oldString: "old", path: "src/app.ts" }),
      success("edit", {
        applied: ["h1"],
        edit: {
          hunks: [
            {
              hunkId: "h1",
              newLines: 4,
              newStart: 1,
              oldLines: 3,
              oldStart: 1,
            },
            {
              hunkId: "h2",
              newLines: 2,
              newStart: 11,
              oldLines: 3,
              oldStart: 10,
            },
          ],
          patch: editedPatch,
          path: "src/app.ts",
        },
        rejected: ["h2"],
        status: "changed",
      })
    );
    expect(text(summary)).toBe("Edited src/app.ts");
    expect(summary.detail).toEqual({
      change: {
        added: 2,
        change: "edited",
        path: "src/app.ts",
        rejected: 1,
        removed: 1,
      },
      kind: "file-change",
    });
  });

  it("says nothing changed when every hunk was rejected", () => {
    const summary = toolSummary(
      call("edit", { newString: "b", oldString: "a", path: "src/app.ts" }),
      success("edit", {
        applied: [],
        edit: {
          hunks: [
            {
              hunkId: "h1",
              newLines: 4,
              newStart: 1,
              oldLines: 3,
              oldStart: 1,
            },
          ],
          patch: editedPatch,
          path: "src/app.ts",
        },
        rejected: ["h1"],
        status: "changed",
      })
    );
    expect(summary.status).toBe("denied");
    expect(text(summary)).toBe("Didn't change src/app.ts");
  });

  it("has a line while a change runs, fails or makes no difference", () => {
    const write = call("write", { content: "x", path: "a.txt" });
    expect(text(toolSummary(write, undefined))).toBe("Writing a.txt");
    const edit = call("edit", {
      newString: "b",
      oldString: "a",
      path: "a.txt",
    });
    expect(text(toolSummary(edit, undefined))).toBe("Editing a.txt");

    const failed = toolSummary(
      edit,
      success("edit", { message: "oldString was not found", status: "error" })
    );
    expect(failed.status).toBe("error");
    expect(text(failed)).toBe("Couldn't change a.txt");
    expect(failed.errorText).toBe("oldString was not found");

    const same = toolSummary(
      write,
      success("write", { path: "a.txt", status: "unchanged" })
    );
    expect(text(same)).toBe("No changes to a.txt");
  });
});

describe("toolSummary: preview, search and other tools", () => {
  it("opens a preview, with its URL for the Open button", () => {
    const summary = toolSummary(
      call("preview", { port: 3000 }),
      success("preview", {
        port: 3000,
        status: "exposed",
        url: "http://localhost:4100/",
      })
    );
    expect(text(summary)).toBe("Opened a preview");
    expect(summary.icon).toBe("MonitorIcon");
    expect(summary.previewUrl).toBe("http://localhost:4100/");
  });

  it("searches files and the web", () => {
    const files = toolSummary(
      call("file_search", { query: "budget" }),
      success("file_search", { results: [] })
    );
    expect(text(files)).toBe("Searched your files");
    expect(files.icon).toBe("SearchIcon");

    const web = call("web_search", { query: "bun 2" });
    expect(text(toolSummary(web, undefined))).toBe("Searching the web");
    expect(
      text(toolSummary(web, success("web_search", { status: "ok" })))
    ).toBe("Searched the web");
    const unavailable = toolSummary(
      web,
      success("web_search", { message: "Search is off", status: "unavailable" })
    );
    expect(unavailable.status).toBe("error");
    expect(text(unavailable)).toBe("Couldn't search the web");
  });

  it("names an MCP tool and its server", () => {
    const mcp = call("github__create_issue", { title: "Bug" });
    const summary = toolSummary(
      mcp,
      success("github__create_issue", { content: [] })
    );
    expect(summary.icon).toBe("WrenchIcon");
    expect(text(summary)).toBe("Used create_issue from github");

    const failed = toolSummary(
      mcp,
      success("github__create_issue", {
        content: [{ text: "Not allowed", type: "text" }],
        isError: true,
      })
    );
    expect(failed.status).toBe("error");
    expect(failed.errorText).toBe("Not allowed");
  });

  it("falls back to the tool's name, with its raw input and output", () => {
    const summary = toolSummary(
      call("sandbox_exec", { command: "bun bench" }),
      success("sandbox_exec", "p95 38ms")
    );
    expect(summary.icon).toBe("ToolIcon");
    expect(text(summary)).toBe("Used sandbox_exec");
    expect(summary.detail).toEqual({
      input: { command: "bun bench" },
      kind: "raw",
      output: "p95 38ms",
    });
  });

  it("is an error when the tool threw", () => {
    const summary = toolSummary(
      call("lookup", {}),
      failure("lookup", "timeout")
    );
    expect(summary.status).toBe("error");
    expect(text(summary)).toBe("Couldn't use lookup");
    expect(summary.errorText).toBe("timeout");
  });
});
