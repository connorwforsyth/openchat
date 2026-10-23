import { builtinKindDefinitions } from "@workspace/artifacts-kit/builtin";
import { describe, expect, it } from "vitest";

import { GALLERY_ORDER, galleryExamples, storedGallery } from "./examples";

const builtinKinds = Object.keys(builtinKindDefinitions).sort();

describe("the artifact gallery", () => {
  it("has exactly one example of every built-in kind", () => {
    expect(Object.keys(galleryExamples).sort()).toEqual(builtinKinds);
  });

  it("shows every example once", () => {
    expect([...GALLERY_ORDER].sort()).toEqual(builtinKinds);
  });

  it.each(storedGallery().map((example) => [example.kind, example] as const))(
    "has a %s example that create_artifact would save",
    (_kind, example) => {
      expect(example.problems).toEqual([]);
    }
  );
});
