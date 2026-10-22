import { fixtureId } from "@workspace/contract/fixtures";
import type { Message } from "@workspace/contract/schemas/messages";
import { describe, expect, it } from "vitest";

import { type ArtifactWatch, watchArtifacts } from "./artifact-openings";

// The panel opens an artifact by itself only when the answer this page is
// watching makes one (or a new version of one), never for history.

interface Row {
  readonly id: string;
  readonly parts: Message["parts"];
}

const ref = (artifact: number, version: number) =>
  ({
    artifactId: fixtureId("artifact", artifact),
    kind: "markdown",
    title: `Artifact ${artifact}`,
    type: "artifact-ref",
    versionId: fixtureId("artifactVersion", version),
  }) as const;

const text = { text: "Here it is.", type: "text" } as const;

const row = (id: string, ...parts: Row["parts"]): Row => ({ id, parts });

/** Looks at each state of the chat in turn, as the screen re-renders. */
const looks = (
  steps: readonly (readonly [readonly Row[], string | null])[]
): (Row["parts"][number] | null)[] => {
  let watch: ArtifactWatch | null = null;
  return steps.map(([messages, watchedId]) => {
    const { open, watch: next } = watchArtifacts(watch, messages, watchedId);
    watch = next;
    return open;
  });
};

describe("watchArtifacts", () => {
  it("leaves the artifacts in the history alone", () => {
    const history = [row("a1", text, ref(1, 11)), row("a2", ref(2, 21))];
    expect(looks([[history, null]])).toEqual([null]);
  });

  it("opens an artifact the watched answer makes", () => {
    const before = [row("a1", ref(1, 11)), row("u2"), row("a2", text)];
    const after = [row("a1", ref(1, 11)), row("u2"), row("a2", ref(2, 21))];
    expect(
      looks([
        [before, null],
        [before, "a2"],
        [after, "a2"],
      ])
    ).toEqual([null, null, ref(2, 21)]);
  });

  it("opens a new version of an artifact already in the chat", () => {
    const before = [row("a1", ref(1, 11)), row("a2")];
    const after = [row("a1", ref(1, 11)), row("a2", ref(1, 12))];
    expect(
      looks([
        [before, "a2"],
        [after, "a2"],
      ])
    ).toEqual([null, ref(1, 12)]);
  });

  it("opens each version once", () => {
    const made = [row("a2", ref(2, 21))];
    expect(
      looks([
        [[row("a2")], "a2"],
        [made, "a2"],
        [[row("a2", text, ref(2, 21))], "a2"],
        [made, null],
      ])
    ).toEqual([null, ref(2, 21), null, null]);
  });

  it("opens the latest when several arrive at once", () => {
    expect(
      looks([
        [[row("a2")], "a2"],
        [[row("a2", ref(2, 21), text, ref(3, 31))], "a2"],
      ])
    ).toEqual([null, ref(3, 31)]);
  });

  it("ignores a stream the page isn't watching, such as one resumed after a reload", () => {
    expect(
      looks([
        [[row("a2")], null],
        [[row("a2", ref(2, 21))], null],
      ])
    ).toEqual([null, null]);
  });

  it("ignores another member's answer arriving while the page watches its own", () => {
    expect(
      looks([
        [[row("a2")], "a2"],
        [[row("b1", ref(4, 41)), row("a2")], "a2"],
      ])
    ).toEqual([null, null]);
  });

  it("still counts the watched answer's last update as its stream ends", () => {
    expect(
      looks([
        [[row("a2")], "a2"],
        [[row("a2", ref(2, 21))], null],
        [[row("a2", ref(2, 21)), row("a3", ref(3, 31))], null],
      ])
    ).toEqual([null, ref(2, 21), null]);
  });
});
