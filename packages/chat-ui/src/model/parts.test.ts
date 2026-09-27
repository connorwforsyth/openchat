import { fixtureId, fixtureTime, userAda } from "@workspace/contract/fixtures";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import {
  indexToolResults,
  MEMORY_TOOL_NAME,
  messageText,
  messageView,
  type ToolCallPart,
  toolViewState,
} from "./parts";

const call = (
  toolCallId: string,
  approval: ToolCallPart["approval"] = { state: "not-required" },
  toolName = "web_search"
): ToolCallPart => ({
  approval,
  input: { query: "x" },
  toolCallId,
  toolName,
  type: "tool-call",
});

describe("messageView", () => {
  it("joins results from later messages, groups files and collects sources", () => {
    const parts: MessagePart[] = [
      { type: "step-start" },
      { text: "thinking", type: "reasoning" },
      call("c1"),
      {
        mediaType: "image/png",
        source: { kind: "url", url: "https://example.test/a.png" },
        type: "file",
      },
      {
        mediaType: "application/pdf",
        source: { fileId: fixtureId("file", 1), kind: "file" },
        type: "file",
      },
      {
        id: "s1",
        source: { kind: "url", url: "https://example.test" },
        type: "source",
      },
      { text: "Answer", type: "text" },
    ];
    const later: MessagePart[] = [
      {
        output: { status: "success", value: 1 },
        toolCallId: "c1",
        toolName: "web_search",
        type: "tool-result",
      },
    ];
    const results = indexToolResults([{ parts }, { parts: later }]);
    const view = messageView(parts, results);
    expect(view.blocks.map((block) => block.kind)).toEqual([
      "reasoning",
      "tool",
      "files",
      "text",
    ]);
    const [, tool, files] = view.blocks;
    expect(tool?.kind === "tool" && tool.result?.output.status).toBe("success");
    expect(files?.kind === "files" && files.files.length).toBe(2);
    expect(view.sources.map((source) => source.id)).toEqual(["s1"]);
  });

  it("turns an applied update_memory result into a memory note", () => {
    const versionId = fixtureId("memoryVersion", 2);
    const parts: MessagePart[] = [
      call("m1", { state: "not-required" }, MEMORY_TOOL_NAME),
      {
        output: {
          status: "success",
          value: {
            number: 2,
            previousVersionId: fixtureId("memoryVersion", 1),
            status: "applied",
            summary: "Prefers pnpm",
            versionId,
          },
        },
        toolCallId: "m1",
        toolName: MEMORY_TOOL_NAME,
        type: "tool-result",
      },
    ];
    const [block] = messageView(parts, indexToolResults([{ parts }])).blocks;
    expect(block).toEqual({
      key: "tool-call-0",
      kind: "memory",
      update: {
        previousVersionId: fixtureId("memoryVersion", 1),
        summary: "Prefers pnpm",
        versionId,
      },
    });
  });

  it("keeps a rejected memory edit as a plain tool call", () => {
    const parts: MessagePart[] = [
      call("m1", { state: "not-required" }, MEMORY_TOOL_NAME),
      {
        output: {
          status: "success",
          value: {
            message: "no match",
            reason: "not_found",
            status: "rejected",
          },
        },
        toolCallId: "m1",
        toolName: MEMORY_TOOL_NAME,
        type: "tool-result",
      },
    ];
    const [block] = messageView(parts, indexToolResults([{ parts }])).blocks;
    expect(block?.kind).toBe("tool");
  });

  it("reads the memory-update data part, which may not know the previous version", () => {
    const parts: MessagePart[] = [
      {
        data: {
          summary: "Prefers pnpm",
          versionId: fixtureId("memoryVersion", 1),
        },
        name: "memory-update",
        type: "data",
      },
      { data: { anything: true }, name: "other-thing", type: "data" },
    ];
    const view = messageView(parts, new Map());
    expect(view.blocks).toHaveLength(1);
    const [block] = view.blocks;
    expect(block?.kind === "memory" && block.update.previousVersionId).toBe(
      undefined
    );
  });
});

describe("toolViewState", () => {
  it("follows the approval lifecycle, then the result", () => {
    expect(toolViewState(call("a"), undefined)).toBe("input-available");
    expect(
      toolViewState(
        call("a", { requestedAt: fixtureTime(), state: "pending" }),
        undefined
      )
    ).toBe("approval-requested");
    expect(
      toolViewState(
        call("a", {
          decidedAt: fixtureTime(),
          decidedBy: userAda.id,
          decision: { decision: "approve" },
          state: "decided",
        }),
        undefined
      )
    ).toBe("approval-responded");
    expect(
      toolViewState(call("a"), {
        output: { message: "boom", status: "error" },
        toolCallId: "a",
        toolName: "web_search",
        type: "tool-result",
      })
    ).toBe("output-error");
  });
});

describe("messageText", () => {
  it("joins text parts only", () => {
    expect(
      messageText({
        parts: [
          { text: "One", type: "text" },
          { text: "hidden", type: "reasoning" },
          { text: "Two", type: "text" },
        ],
      })
    ).toBe("One\n\nTwo");
  });
});
