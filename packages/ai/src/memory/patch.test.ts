import { describe, expect, it } from "vitest";

import { applyMemoryPatch, applyMemoryPatches } from "./patch";

const file = "- Prefers pnpm\n- Lives in Lisbon\n";

describe("applyMemoryPatch", () => {
  it("appends an entry on a line of its own", () => {
    expect(applyMemoryPatch("", { op: "append", text: "- Uses vim" })).toEqual({
      ok: true,
      value: "- Uses vim\n",
    });
    expect(
      applyMemoryPatch("- Prefers pnpm", { op: "append", text: "- Uses vim  " })
    ).toEqual({ ok: true, value: "- Prefers pnpm\n- Uses vim\n" });
  });

  it("replaces an exact, unique snippet", () => {
    expect(
      applyMemoryPatch(file, {
        find: "Lisbon",
        op: "replace",
        replace: "Porto",
      })
    ).toEqual({ ok: true, value: "- Prefers pnpm\n- Lives in Porto\n" });
  });

  it("treats the replacement literally, `$` and all", () => {
    expect(
      applyMemoryPatch("price: X", { find: "X", op: "replace", replace: "$&5" })
    ).toEqual({ ok: true, value: "price: $&5" });
  });

  it("deletes a whole entry without leaving a blank line", () => {
    expect(
      applyMemoryPatch(file, { find: "- Prefers pnpm", op: "delete" })
    ).toEqual({ ok: true, value: "- Lives in Lisbon\n" });
    expect(
      applyMemoryPatch(file, { find: "- Lives in Lisbon", op: "delete" })
    ).toEqual({ ok: true, value: "- Prefers pnpm\n" });
  });

  it("deletes part of a line and keeps the rest", () => {
    expect(
      applyMemoryPatch(file, { find: " in Lisbon", op: "delete" })
    ).toEqual({ ok: true, value: "- Prefers pnpm\n- Lives\n" });
  });

  it("refuses a snippet that isn't there, or is there twice", () => {
    expect(
      applyMemoryPatch(file, { find: "yarn", op: "replace", replace: "npm" })
    ).toEqual({
      error: { find: "yarn", index: 0, type: "not_found" },
      ok: false,
    });
    expect(applyMemoryPatch(file, { find: "- ", op: "delete" })).toEqual({
      error: { count: 2, find: "- ", index: 0, type: "ambiguous" },
      ok: false,
    });
  });
});

describe("applyMemoryPatches", () => {
  it("applies patches in order, each on the last one's result", () => {
    expect(
      applyMemoryPatches(file, [
        { find: "pnpm", op: "replace", replace: "bun" },
        { find: "bun", op: "replace", replace: "bun (not npm)" },
        { op: "append", text: "- Uses vim" },
      ])
    ).toEqual({
      ok: true,
      value: "- Prefers bun (not npm)\n- Lives in Lisbon\n- Uses vim\n",
    });
  });

  it("is all or nothing, and says which patch failed", () => {
    expect(
      applyMemoryPatches(file, [
        { op: "append", text: "- Uses vim" },
        { find: "emacs", op: "delete" },
      ])
    ).toEqual({
      error: { find: "emacs", index: 1, type: "not_found" },
      ok: false,
    });
  });
});
