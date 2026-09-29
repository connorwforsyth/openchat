import { fixtureId } from "@workspace/contract/fixtures";
import type { Message } from "@workspace/contract/schemas/messages";
import { describe, expect, it } from "vitest";

import {
  sectionOf,
  shownSelection,
  workspacePath,
  workspaceRevision,
} from "./workspace";

type Parts = Pick<Message, "parts">;

const call = (
  toolName: string,
  toolCallId: string
): Parts["parts"][number] => ({
  approval: { state: "not-required" },
  input: {},
  toolCallId,
  toolName,
  type: "tool-call",
});

const result = (
  toolName: string,
  toolCallId: string
): Parts["parts"][number] => ({
  output: { status: "success", value: null },
  toolCallId,
  toolName,
  type: "tool-result",
});

describe("workspaceRevision", () => {
  it("counts settled workspace-tool results, not calls or other tools", () => {
    const messages: Parts[] = [
      { parts: [{ text: "hi", type: "text" }] },
      {
        parts: [
          call("write", "a"),
          result("write", "a"),
          call("bash", "b"),
          call("web_search", "c"),
          result("web_search", "c"),
        ],
      },
    ];
    expect(workspaceRevision(messages)).toBe(1);
  });

  it("moves as results stream in", () => {
    const streaming: Parts[] = [{ parts: [call("bash", "b")] }];
    const before = workspaceRevision(streaming);
    const settled: Parts[] = [
      { parts: [call("bash", "b"), result("bash", "b")] },
      { parts: [result("edit", "e")] },
    ];
    expect(workspaceRevision(settled)).toBe(before + 2);
  });
});

describe("shownSelection", () => {
  const artifactId = fixtureId("artifact", 1);

  it("shows the selection on its own section", () => {
    const file = { kind: "file" as const, path: "a.ts" };
    expect(shownSelection("files", file, false)).toBe(file);
    const artifact = { artifactId, kind: "artifact" as const };
    expect(shownSelection("artifacts", artifact, false)).toBe(artifact);
  });

  it("falls back to the section's default", () => {
    const file = { kind: "file" as const, path: "a.ts" };
    expect(shownSelection("artifacts", file, true)).toEqual({
      kind: "artifact",
    });
    expect(
      shownSelection("files", { artifactId, kind: "artifact" }, true)
    ).toEqual({ kind: "preview" });
    expect(shownSelection("files", null, false)).toBeNull();
  });

  it("drops a preview the workspace no longer has", () => {
    expect(shownSelection("files", { kind: "preview" }, false)).toBeNull();
  });

  it("knows which section a selection lives in", () => {
    expect(sectionOf({ kind: "preview" })).toBe("files");
    expect(sectionOf({ kind: "artifact" })).toBe("artifacts");
  });
});

describe("workspacePath", () => {
  it("makes tool paths relative to the workspace", () => {
    expect(workspacePath("/work/src/a.ts")).toBe("src/a.ts");
    expect(workspacePath("./notes.md")).toBe("notes.md");
    expect(workspacePath("notes.md")).toBe("notes.md");
    expect(workspacePath("/workshop/a.md")).toBe("workshop/a.md");
  });
});
