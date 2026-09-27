import { fixtureId, userAda } from "@workspace/contract/fixtures";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { treeMessages } from "../fixtures";
import { liveParts, liveTail, mergeLive } from "./live-messages";

const ui = (id: string, role: UIMessage["role"], text: string): UIMessage => ({
  id,
  parts: [{ text, type: "text" }],
  role,
});

describe("liveTail", () => {
  it("keeps only what the stored path doesn't have yet", () => {
    const live = [
      ui("a", "user", "1"),
      ui("b", "assistant", "2"),
      ui("c", "user", "3"),
    ];
    expect(liveTail(new Set(["a", "b"]), live).map((m) => m.id)).toEqual(["c"]);
    expect(liveTail(new Set(), live)).toHaveLength(3);
    expect(liveTail(new Set(["c"]), live)).toEqual([]);
  });
});

describe("mergeLive", () => {
  const path = treeMessages.slice(0, 2);
  const context = {
    authorId: userAda.id,
    conversationId: path[0]?.conversationId ?? fixtureId("conversation", 1),
    now: "2026-09-27T10:00:00.000Z",
  };

  it("chains the live tail onto the stored path", () => {
    const merged = mergeLive(
      path,
      [ui("q", "user", "Next?"), ui("r", "assistant", "Streaming")],
      context
    );
    expect(merged.map((m) => m.id)).toEqual([
      path[0]?.id,
      path[1]?.id,
      "q",
      "r",
    ]);
    expect(merged[2]?.parentId).toBe(path[1]?.id);
    expect(merged[2]?.authorId).toBe(userAda.id);
    expect(merged[3]?.parentId).toBe("q");
    expect(merged[3]?.parts).toEqual([{ text: "Streaming", type: "text" }]);
  });

  it("returns the path itself when nothing is live, and reuses cached rows", () => {
    expect(mergeLive(path, [], context)).toBe(path);
    const cache = new WeakMap();
    const question = ui("q", "user", "Next?");
    const first = mergeLive(
      path,
      [question, ui("r", "assistant", "a")],
      context,
      cache
    );
    const second = mergeLive(
      path,
      [question, ui("r", "assistant", "ab")],
      context,
      cache
    );
    expect(second[2]).toBe(first[2]);
    expect(second[3]).not.toBe(first[3]);
  });

  it("shows the streaming message live where the path already stores it", () => {
    const [question, answer] = path;
    if (!(question && answer)) {
      throw new Error("fixture path is too short");
    }
    const placeholder = { ...answer, parts: [], status: "partial" as const };
    const stored = [question, placeholder];
    const streaming = ui(answer.id, "assistant", "Half an ans");
    const merged = mergeLive(
      stored,
      [streaming],
      context,
      undefined,
      answer.id
    );
    expect(merged.map((m) => m.id)).toEqual([question.id, answer.id]);
    expect(merged[1]?.parts).toEqual([{ text: "Half an ans", type: "text" }]);
    expect(merged[1]?.parentId).toBe(placeholder.parentId);
    expect(merged[1]?.createdAt).toBe(placeholder.createdAt);
    // Not streaming (a finished or stopped turn): the stored message wins.
    expect(mergeLive(stored, [streaming], context)).toBe(stored);
  });
});

describe("liveParts", () => {
  it("falls back to prose when a tool outcome isn't in the stream", () => {
    expect(
      liveParts({
        parts: [
          { text: "Before", type: "text" },
          {
            approval: { approved: true, id: "c1" },
            input: {},
            output: 1,
            state: "output-available",
            toolCallId: "c1",
            type: "tool-edit",
          },
        ],
      })
    ).toEqual([{ text: "Before", type: "text" }]);
  });
});
