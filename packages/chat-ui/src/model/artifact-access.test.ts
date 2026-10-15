import type { ArtifactId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import {
  artifactInView,
  historyModeFor,
  parseArtifactParam,
  stepArtifact,
  unseenArtifacts,
} from "./artifact-access";

const a = "0190a000-0000-7000-8000-00000000000a" as ArtifactId;
const b = "0190a000-0000-7000-8000-00000000000b" as ArtifactId;
const c = "0190a000-0000-7000-8000-00000000000c" as ArtifactId;

describe("parseArtifactParam", () => {
  it("reads an id and drops anything else", () => {
    expect(parseArtifactParam(a)).toBe(a);
    expect(parseArtifactParam("nope")).toBeNull();
    expect(parseArtifactParam(null)).toBeNull();
    expect(parseArtifactParam(undefined)).toBeNull();
  });
});

describe("artifactInView", () => {
  it("names the picked artifact while the panel shows artifacts", () => {
    expect(
      artifactInView("artifacts", { artifactId: a, kind: "artifact" })
    ).toBe(a);
  });

  it("names nothing for the default, another section or a closed panel", () => {
    expect(artifactInView("artifacts", { kind: "artifact" })).toBeNull();
    expect(artifactInView("files", { artifactId: a, kind: "artifact" })).toBe(
      null
    );
    expect(artifactInView(null, { artifactId: a, kind: "artifact" })).toBe(
      null
    );
    expect(artifactInView("artifacts", { kind: "preview" })).toBeNull();
  });
});

describe("historyModeFor", () => {
  it("pushes opening and replaces switching or closing", () => {
    expect(historyModeFor(null, a)).toBe("push");
    expect(historyModeFor(a, b)).toBe("replace");
    expect(historyModeFor(a, null)).toBe("replace");
  });
});

describe("stepArtifact", () => {
  const ids = [a, b, c];
  it("moves through the list and stops at its ends", () => {
    expect(stepArtifact(ids, a, 1)).toBe(b);
    expect(stepArtifact(ids, b, -1)).toBe(a);
    expect(stepArtifact(ids, c, 1)).toBeNull();
    expect(stepArtifact(ids, a, -1)).toBeNull();
  });

  it("starts from the first when nothing (or a stranger) is picked", () => {
    expect(stepArtifact(ids, undefined, 1)).toBe(b);
    expect(stepArtifact(ids, "x" as ArtifactId, 1)).toBe(b);
    expect(stepArtifact([], a, 1)).toBeNull();
  });
});

describe("unseenArtifacts", () => {
  it("lists the ones not seen yet", () => {
    expect(unseenArtifacts(new Set([a]), [a, b, c])).toEqual([b, c]);
    expect(unseenArtifacts(new Set([a, b]), [a, b])).toEqual([]);
  });
});
