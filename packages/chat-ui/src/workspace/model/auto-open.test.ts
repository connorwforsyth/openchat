import type { Message } from "@workspace/contract/schemas/messages";
import { describe, expect, it } from "vitest";

import { previewOpenings, watchOpenings } from "./auto-open";

// When the panel opens by itself (066): a page written or edited, or a
// preview started, as it happens, never for history.

interface Row {
  readonly id: string;
  readonly parts: Message["parts"];
}
type Part = Row["parts"][number];

const HASH = "a".repeat(64);

const write = (id: string, path: string): Part => ({
  approval: { state: "not-required" },
  input: { content: "<p>hi</p>", path },
  toolCallId: id,
  toolName: "write",
  type: "tool-call",
});

/** A write that landed: one applied hunk creating the file. */
const written = (id: string, path: string): Part => ({
  output: {
    status: "success",
    value: {
      applied: ["h1"],
      edit: {
        hunks: [{ hunkId: "h1" }],
        patch: `--- ${path}\tsha256:${HASH}\n+++ ${path}\n@@ -0,0 +1 @@\n+<p>hi</p>\n`,
        path,
      },
      rejected: [],
      status: "changed",
    },
  },
  toolCallId: id,
  toolName: "write",
  type: "tool-result",
});

const refused = (id: string): Part => ({
  output: { decision: { decision: "reject" }, status: "denied" },
  toolCallId: id,
  toolName: "write",
  type: "tool-result",
});

const preview = (id: string): Part => ({
  approval: { state: "not-required" },
  input: { port: 5173 },
  toolCallId: id,
  toolName: "preview",
  type: "tool-call",
});

const exposed = (id: string): Part => ({
  output: {
    status: "success",
    value: { status: "exposed", url: "https://s-5173.preview.test/" },
  },
  toolCallId: id,
  toolName: "preview",
  type: "tool-result",
});

describe("previewOpenings", () => {
  it("finds pages written and previews started, and nothing else", () => {
    const messages: Row[] = [
      {
        id: "m1",
        parts: [
          write("a", "/work/index.html"),
          written("a", "/work/index.html"),
          write("b", "notes.md"),
          written("b", "notes.md"),
          write("c", "other.html"),
          refused("c"),
          write("d", "pending.html"),
          preview("e"),
          exposed("e"),
        ],
      },
    ];
    expect(previewOpenings(messages)).toEqual([
      {
        messageIds: ["m1", "m1"],
        path: "index.html",
        toolCallId: "a",
        url: null,
      },
      {
        messageIds: ["m1", "m1"],
        path: null,
        toolCallId: "e",
        url: "https://s-5173.preview.test/",
      },
    ]);
  });

  it("knows a result that landed in a later message, after an approval", () => {
    const messages: Row[] = [
      { id: "m1", parts: [write("a", "index.html")] },
      { id: "m2", parts: [written("a", "index.html")] },
    ];
    expect(previewOpenings(messages)[0]?.messageIds).toEqual(["m1", "m2"]);
  });
});

describe("watchOpenings", () => {
  it("only takes stock the first time: history doesn't open the panel", () => {
    const history: Row[] = [
      { id: "m1", parts: [write("a", "a.html"), written("a", "a.html")] },
    ];
    const first = watchOpenings(null, history, null);
    expect(first.open).toBeNull();
    // Nothing new since.
    expect(watchOpenings(first.watch, history, null).open).toBeNull();
  });

  it("opens for a page written in a message already on screen, once", () => {
    const pending: Row[] = [{ id: "m1", parts: [write("a", "a.html")] }];
    const { watch } = watchOpenings(null, pending, null);
    const settled: Row[] = [
      { id: "m1", parts: [write("a", "a.html"), written("a", "a.html")] },
    ];
    const seen = watchOpenings(watch, settled, null);
    expect(seen.open?.path).toBe("a.html");
    expect(watchOpenings(seen.watch, settled, null).open).toBeNull();
  });

  it("opens for the streaming message even when it arrives settled", () => {
    const { watch } = watchOpenings(null, [], null);
    const streamed: Row[] = [{ id: "m9", parts: [preview("p"), exposed("p")] }];
    expect(watchOpenings(watch, streamed, "m9").open?.toolCallId).toBe("p");
  });

  it("doesn't open for a branch switched to: its messages weren't on screen", () => {
    const { watch } = watchOpenings(null, [{ id: "m1", parts: [] }], null);
    const other: Row[] = [
      { id: "m2", parts: [write("a", "a.html"), written("a", "a.html")] },
    ];
    expect(watchOpenings(watch, other, null).open).toBeNull();
  });

  it("opens on the newest when several land together", () => {
    const { watch } = watchOpenings(null, [{ id: "m1", parts: [] }], "m1");
    const both: Row[] = [
      {
        id: "m1",
        parts: [
          write("a", "a.html"),
          written("a", "a.html"),
          write("b", "b.html"),
          written("b", "b.html"),
        ],
      },
    ];
    expect(watchOpenings(watch, both, "m1").open?.path).toBe("b.html");
  });
});
