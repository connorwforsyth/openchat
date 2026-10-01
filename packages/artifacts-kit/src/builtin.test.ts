import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import { builtinArtifactKinds, builtinKindDefinitions } from "./builtin";
import { TEXT_MAX_CHARS } from "./kinds/text";

// Today's kinds as definitions (ticket 123). Which content each accepts is
// pinned by the golden snapshot in `packages/ai` (`artifact-golden.test.ts`);
// these say how they're put together.

describe("the built-in kinds", () => {
  it("define every kind the contract stores, under its own name", () => {
    expect([...builtinArtifactKinds.kinds].sort()).toEqual(
      [...artifactKindSchema.options].sort()
    );
    for (const [key, definition] of Object.entries(builtinKindDefinitions)) {
      expect(definition.kind).toBe(key);
    }
  });

  it("are text, replaced whole, with no instructions of their own", () => {
    for (const definition of builtinArtifactKinds.list()) {
      expect(Object.keys(definition.operations)).toEqual(["replace"]);
      expect(
        definition.operations.replace?.apply("before", { content: "after" })
      ).toBe("after");
      expect(definition.instructions).toBe("");
      expect(definition.editor).toBe("none");
      expect(definition.diff).toBe("text");
    }
    expect(builtinArtifactKinds.instructionFiles()).toEqual([]);
  });

  it("render in the runtime where they did, and the panel otherwise", () => {
    const renders = Object.fromEntries(
      builtinArtifactKinds
        .list()
        .map((definition) => [definition.kind, definition.render])
    );
    expect(renders).toEqual({
      code: { panel: "source", runtime: null },
      html: { panel: "frame", runtime: "html" },
      markdown: { panel: "markdown", runtime: null },
      mermaid: { panel: "source", runtime: "mermaid" },
      react: {
        imports: ["react", "react-dom"],
        panel: "source",
        runtime: "react",
      },
      svg: { panel: "frame", runtime: "svg" },
    });
  });

  it("let only React be annotated, and none share, present or call the model", () => {
    for (const definition of builtinArtifactKinds.list()) {
      expect(definition.capabilities).toEqual({
        aiCalls: false,
        annotate: definition.kind === "react",
        present: false,
        share: false,
      });
    }
  });

  it("cap content at the tools' limit", () => {
    const longest = "x".repeat(TEXT_MAX_CHARS);
    expect(builtinArtifactKinds.check("code", longest)).toEqual([]);
    expect(builtinArtifactKinds.check("code", `${longest}x`)).toEqual([
      `content is longer than ${TEXT_MAX_CHARS} characters`,
    ]);
  });

  it("say content of the wrong shape isn't a valid artifact of the kind", () => {
    expect(builtinArtifactKinds.check("react", "function App() {}")).toEqual([
      "content isn't a valid react artifact",
    ]);
    expect(builtinArtifactKinds.check("svg", "<svg></svg>")).toEqual([]);
    expect(builtinArtifactKinds.check("mermaid", "journey\n  A")).toEqual([
      "content isn't a valid mermaid artifact",
    ]);
  });
});
