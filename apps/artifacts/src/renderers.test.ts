import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { reactKind } from "@workspace/artifacts-kit/kinds/react";
import {
  RUNTIME_IMPORTS,
  runtimeKindSchema,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { describe, expect, it } from "vitest";

import { rendererFor, runtimeRenderers } from "./renderers";

// The runtime draws each kind with the renderer its definition names
// (ticket 123). The protocol the panel speaks (`runtime-protocol`) must
// agree with the definitions on which kinds reach the runtime, and on what
// React may import.

describe("the runtime's renderers", () => {
  it("draw exactly the kinds the protocol sends the runtime", () => {
    const drawn = builtinArtifactKinds.kinds.filter(
      (kind) => rendererFor(kind) !== null
    );
    expect([...drawn].sort()).toEqual([...runtimeKindSchema.options].sort());
  });

  it("cover every renderer a kind names, and no others", () => {
    const named = builtinArtifactKinds
      .list()
      .flatMap((definition) =>
        definition.render.runtime ? [definition.render.runtime] : []
      );
    expect(Object.keys(runtimeRenderers).sort()).toEqual([...named].sort());
  });

  it("have nothing for a kind the runtime doesn't take", () => {
    expect(rendererFor("markdown")).toBeNull();
    expect(rendererFor("code")).toBeNull();
    expect(rendererFor("site")).toBeNull();
  });

  it("let React import what the protocol says it may", () => {
    expect(reactKind.render.imports).toEqual(RUNTIME_IMPORTS);
  });
});
