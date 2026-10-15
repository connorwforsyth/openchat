import { describe, expect, it } from "vitest";
import { z } from "zod";

import { matches } from "./checks";
import {
  type ArtifactStarter,
  checkArtifact,
  defineArtifactKind,
  defineOperation,
  starterKindsOf,
} from "./define";

const append = defineOperation({
  apply: (
    current: { readonly lines: readonly string[] } | null,
    input: { readonly line: string }
  ) => ({ lines: [...(current?.lines ?? []), input.line] }),
  description: "Add a line at the end.",
  input: z.object({ line: z.string() }),
});

// A kind with structured content, as Sites and Documents will have.
const notes = defineArtifactKind({
  capabilities: {
    aiCalls: false,
    annotate: false,
    present: false,
    share: false,
  },
  checks: [
    matches<{ readonly lines: readonly string[] }>(
      /\S/,
      "notes need at least one line with text",
      (content) => content.lines.join("\n")
    ),
    {
      name: "short lines",
      run: (content) =>
        content.lines
          .filter((line) => line.length > 10)
          .map((line) => `"${line}" is longer than 10 characters`),
    },
  ],
  content: z.object({ lines: z.array(z.string()).max(3) }),
  diff: "text",
  editor: "none",
  export: [{ extension: "txt", format: "file" }],
  icon: "FileTextIcon",
  instructions: "Keep notes short.",
  kind: "notes",
  label: "Notes",
  operations: { append },
  render: { panel: "source", runtime: null },
  thumbnail: "none",
});

describe("starterKindsOf", () => {
  it("keeps kinds with a starter, by order and then as defined", () => {
    const kinds: readonly {
      readonly kind: string;
      readonly starter?: ArtifactStarter;
    }[] = [
      { kind: "a", starter: {} },
      { kind: "b" },
      { kind: "c", starter: { badge: "beta", order: 2 } },
      { kind: "d", starter: {} },
      { kind: "e", starter: { order: 1 } },
    ];
    expect(starterKindsOf(kinds).map((each) => each.kind)).toEqual([
      "e",
      "c",
      "a",
      "d",
    ]);
  });
});

describe("checkArtifact", () => {
  it("passes content with the shape that every check accepts", () => {
    expect(checkArtifact(notes, { lines: ["one", "two"] })).toEqual([]);
  });

  it("reports the shape first, and runs no check on the wrong shape", () => {
    expect(checkArtifact(notes, { lines: "one" })).toEqual([
      "lines Invalid input: expected array, received string",
    ]);
    expect(checkArtifact(notes, "one")).toEqual([
      "content Invalid input: expected object, received string",
    ]);
  });

  it("reports every check's problems, in order", () => {
    expect(checkArtifact(notes, { lines: [" ", "a very long line"] })).toEqual([
      '"a very long line" is longer than 10 characters',
    ]);
    expect(checkArtifact(notes, { lines: [" "] })).toEqual([
      "notes need at least one line with text",
    ]);
  });
});

describe("operations", () => {
  it("apply to the latest content, or to none", () => {
    const first = notes.operations.append?.apply(null, { line: "one" });
    expect(first).toEqual({ lines: ["one"] });
    expect(append.apply({ lines: ["one"] }, { line: "two" })).toEqual({
      lines: ["one", "two"],
    });
  });
});
