import { describe, expect, it } from "vitest";

import type { WorkspaceFileRead } from "./client";
import {
  hasUnsavedEdits,
  MAX_EDITABLE_BYTES,
  type OpenFile,
  openFileReducer,
  parseNewFileName,
  shouldSave,
} from "./editor";

const V1 = "1".repeat(64);
const V2 = "2".repeat(64);

const read = (
  content: string,
  etag = V1,
  size = content.length
): WorkspaceFileRead => ({ content, encoding: "utf8", etag, size });

const opened = (content = "hello", etag = V1): OpenFile | null =>
  openFileReducer(openFileReducer(null, { path: "a.md", type: "load" }), {
    path: "a.md",
    read: read(content, etag),
    type: "loaded",
  });

describe("openFileReducer", () => {
  it("opens text for editing, big files read-only and binaries as such", () => {
    expect(opened()).toMatchObject({
      base: "hello",
      draft: "hello",
      etag: V1,
      kind: "text",
      readOnly: false,
      save: { status: "saved" },
    });
    const loading = openFileReducer(null, { path: "big.log", type: "load" });
    expect(
      openFileReducer(loading, {
        path: "big.log",
        read: read("x", V1, MAX_EDITABLE_BYTES + 1),
        type: "loaded",
      })
    ).toMatchObject({ readOnly: true });
    const image = openFileReducer(null, { path: "a.png", type: "load" });
    expect(
      openFileReducer(image, {
        path: "a.png",
        read: { content: "AAAA", encoding: "base64", etag: V1, size: 3 },
        type: "loaded",
      })
    ).toEqual({ kind: "binary", path: "a.png", size: 3 });
  });

  it("ignores an answer for a file that's no longer selected", () => {
    const other = openFileReducer(null, { path: "b.md", type: "load" });
    expect(
      openFileReducer(other, { path: "a.md", read: read("x"), type: "loaded" })
    ).toBe(other);
  });

  it("tracks edits, a save in flight and typing during it", () => {
    let state = openFileReducer(opened(), { text: "hello!", type: "edited" });
    expect(state).toMatchObject({ save: { status: "dirty" } });
    expect(shouldSave(state)).toBe(true);

    state = openFileReducer(state, { sent: "hello!", type: "saving" });
    state = openFileReducer(state, { text: "hello!!", type: "edited" });
    expect(shouldSave(state)).toBe(false);

    state = openFileReducer(state, { etag: V2, type: "saved" });
    expect(state).toMatchObject({
      base: "hello!",
      draft: "hello!!",
      etag: V2,
      save: { status: "dirty" },
    });
    expect(shouldSave(state)).toBe(true);
  });

  it("holds a conflict until Reload or Overwrite", () => {
    let state = openFileReducer(opened(), { text: "mine", type: "edited" });
    state = openFileReducer(state, { sent: "mine", type: "saving" });
    state = openFileReducer(state, { type: "conflict" });
    state = openFileReducer(state, { text: "mine too", type: "edited" });
    expect(state).toMatchObject({ save: { status: "conflict" } });
    expect(shouldSave(state)).toBe(false);
    expect(hasUnsavedEdits(state)).toBe(true);

    // Reload: the agent's version replaces the draft, and the editor restarts.
    state = openFileReducer(state, { path: "a.md", type: "load" });
    state = openFileReducer(state, {
      path: "a.md",
      read: read("theirs", V2),
      type: "loaded",
    });
    expect(state).toMatchObject({
      draft: "theirs",
      etag: V2,
      loadCount: 1,
      opened: "theirs",
      save: { status: "saved" },
    });
  });

  it("keeps the editor when a reload finds the same version", () => {
    const state = openFileReducer(opened(), { text: "typing", type: "edited" });
    expect(
      openFileReducer(state, {
        path: "a.md",
        read: read("hello"),
        type: "loaded",
      })
    ).toBe(state);
  });
});

describe("parseNewFileName", () => {
  it("accepts workspace paths and refuses ways out", () => {
    expect(parseNewFileName(" notes.md ")).toEqual({
      ok: true,
      value: "notes.md",
    });
    expect(parseNewFileName("/src//app.ts")).toEqual({
      ok: true,
      value: "src/app.ts",
    });
    expect(parseNewFileName("  ")).toEqual({ error: "empty", ok: false });
    expect(parseNewFileName("src/")).toEqual({
      error: "directory",
      ok: false,
    });
    expect(parseNewFileName("../etc/passwd")).toEqual({
      error: "outside",
      ok: false,
    });
  });
});
