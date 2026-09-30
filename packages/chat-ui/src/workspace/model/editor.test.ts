import { describe, expect, it } from "vitest";

import type { WorkspaceFileRead } from "./client";
import {
  fitsKeepalive,
  hasUnsavedEdits,
  KEEPALIVE_MAX_BYTES,
  MAX_EDITABLE_BYTES,
  type OpenFile,
  openFileReducer,
  parseNewFileName,
  safeToLeave,
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

describe("a slow save", () => {
  it("says so only once it's been slow, and only for the save in flight", () => {
    let state = openFileReducer(opened(), { text: "hello!", type: "edited" });
    state = openFileReducer(state, { sent: "hello!", type: "saving" });
    expect(state).toMatchObject({ save: { slow: false, status: "saving" } });

    // Typing during it doesn't make it a new save.
    const typing = openFileReducer(state, { text: "hello!!", type: "edited" });
    expect(typing).toMatchObject({ save: { slow: false, status: "saving" } });

    // A timer for an earlier save changes nothing.
    expect(openFileReducer(typing, { sent: "hello", type: "save-slow" })).toBe(
      typing
    );
    state = openFileReducer(typing, { sent: "hello!", type: "save-slow" });
    expect(state).toMatchObject({ save: { slow: true, status: "saving" } });

    // Landing settles it: the rest is still to save.
    state = openFileReducer(state, { etag: V2, type: "saved" });
    expect(state).toMatchObject({ save: { status: "dirty" } });
  });
});

describe("leaving the page", () => {
  const big = "x".repeat(KEEPALIVE_MAX_BYTES);

  it("fits keepalive by the JSON body, escapes included", () => {
    expect(fitsKeepalive("hello", "/work/a.md")).toBe(true);
    expect(fitsKeepalive(big, "/work/a.md")).toBe(false);
    // Each quote is two bytes once escaped.
    const quotes = '"'.repeat(KEEPALIVE_MAX_BYTES / 2);
    expect(fitsKeepalive(quotes, "/work/a.md")).toBe(false);
  });

  it("is safe with nothing to save, or pending edits the flush can send", () => {
    expect(safeToLeave(null)).toBe(true);
    expect(safeToLeave(opened())).toBe(true);
    const dirty = openFileReducer(opened(), { text: "hi!", type: "edited" });
    expect(safeToLeave(dirty)).toBe(true);
    const failed = openFileReducer(
      openFileReducer(dirty, { sent: "hi!", type: "saving" }),
      { message: "no", type: "save-failed" }
    );
    expect(safeToLeave(failed)).toBe(true);
    // A keepalive save in flight lands on its own.
    expect(
      safeToLeave(openFileReducer(dirty, { sent: "hi!", type: "saving" }))
    ).toBe(true);
  });

  it("warns for edits that can't outlive the page", () => {
    // Too big for keepalive.
    const huge = openFileReducer(opened(), { text: big, type: "edited" });
    expect(safeToLeave(huge)).toBe(false);
    // Typed during a save: can't be sent until it says which version it made.
    let state = openFileReducer(opened(), { text: "a", type: "edited" });
    state = openFileReducer(state, { sent: "a", type: "saving" });
    state = openFileReducer(state, { text: "ab", type: "edited" });
    expect(safeToLeave(state)).toBe(false);
    // Held by a conflict.
    state = openFileReducer(state, { type: "conflict" });
    expect(safeToLeave(state)).toBe(false);
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
