import { newId } from "@workspace/shared/ids";
import { describe, expect, it } from "vitest";

import { type DraftNote, draftsReducer, parseDrafts, sendable } from "./drafts";

const versionId = newId("artifactVersion");
const add = (drafts: readonly DraftNote[], id: string) =>
  draftsReducer(drafts, {
    id,
    mark: { shape: "point", x: 0.1, y: 0.2 },
    type: "add",
    version: 2,
    versionId,
  });

describe("draftsReducer", () => {
  it("adds a note, writes it, says where it points and removes it", () => {
    let drafts = add([], "a");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.target).toBeUndefined();
    drafts = draftsReducer(drafts, { id: "a", note: "Bigger", type: "write" });
    drafts = draftsReducer(drafts, {
      id: "a",
      target: { selector: "h1", type: "element" },
      type: "locate",
    });
    expect(drafts[0]).toMatchObject({
      note: "Bigger",
      target: { selector: "h1", type: "element" },
    });
    expect(draftsReducer(drafts, { id: "a", type: "remove" })).toEqual([]);
    expect(draftsReducer(add(drafts, "b"), { type: "clear" })).toEqual([]);
  });

  it("stops at the most notes a message carries", () => {
    let drafts: readonly DraftNote[] = [];
    for (let index = 0; index < 25; index += 1) {
      drafts = add(drafts, String(index));
    }
    expect(drafts).toHaveLength(20);
  });
});

describe("sendable", () => {
  it("sends written notes only, with what's known of where", () => {
    const drafts = draftsReducer(add(add([], "a"), "b"), {
      id: "b",
      note: "  Darker  ",
      type: "write",
    });
    expect(sendable(drafts)).toEqual([
      {
        mark: { shape: "point", x: 0.1, y: 0.2 },
        note: "Darker",
        target: null,
        version: 2,
        versionId,
      },
    ]);
  });
});

describe("parseDrafts", () => {
  it("reads back what was stored, and nothing from anything else", () => {
    const drafts = add([], "a");
    expect(parseDrafts(JSON.stringify(drafts))).toEqual(drafts);
    expect(parseDrafts("{nope")).toEqual([]);
    expect(parseDrafts(JSON.stringify([{ id: "a" }]))).toEqual([]);
    expect(parseDrafts(null)).toEqual([]);
  });
});
