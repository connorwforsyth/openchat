import { describe, expect, it } from "vitest";

import {
  COALESCE_MS,
  canRedo,
  canUndo,
  record,
  redo,
  startHistory,
  undo,
} from "./history";
import { undoKeyAction } from "./use-history";

describe("an editor's history", () => {
  it("steps back and forward through what was kept", () => {
    let history = startHistory("a");
    history = record(history, "b", { at: 1000 });
    history = record(history, "c", { at: 5000 });
    expect(canUndo(history)).toBe(true);
    history = undo(history);
    expect(history.present).toBe("b");
    history = undo(history);
    expect(history.present).toBe("a");
    expect(canUndo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    history = redo(history);
    expect(history.present).toBe("b");
    expect(canRedo(history)).toBe(true);
  });

  it("folds quick edits to one field into one step", () => {
    let history = startHistory("");
    history = record(history, "H", { at: 0, key: "words" });
    history = record(history, "Hi", { at: COALESCE_MS - 1, key: "words" });
    history = record(history, "Hi!", { at: COALESCE_MS * 4, key: "words" });
    expect(undo(history).present).toBe("Hi");
    expect(undo(undo(history)).present).toBe("");
  });

  it("drops what could be redone once something new is kept", () => {
    let history = record(startHistory("a"), "b", { at: 0 });
    history = record(undo(history), "c", { at: 10_000 });
    expect(canRedo(history)).toBe(false);
    expect(history.past).toEqual(["a"]);
  });
});

describe("undoKeyAction", () => {
  const key = (
    k: string,
    mods: Partial<Record<"ctrl" | "meta" | "shift", boolean>> = {}
  ) => ({
    ctrlKey: mods.ctrl ?? false,
    key: k,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
  });

  it("reads ⌘Z, ⇧⌘Z and Ctrl+Y, and nothing else", () => {
    expect(undoKeyAction(key("z", { meta: true }))).toBe("undo");
    expect(undoKeyAction(key("Z", { meta: true, shift: true }))).toBe("redo");
    expect(undoKeyAction(key("y", { ctrl: true }))).toBe("redo");
    expect(undoKeyAction(key("z"))).toBeNull();
    expect(undoKeyAction(key("y", { meta: true }))).toBeNull();
  });
});
