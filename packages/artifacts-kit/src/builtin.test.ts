import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import { builtinArtifactKinds, builtinKindDefinitions } from "./builtin";
import { IMAGE_MAX_CHARS, imageDataUrl } from "./kinds/image";
import { TEXT_MAX_CHARS } from "./kinds/text";

// Today's kinds as definitions (ticket 123). Which content each accepts is
// pinned by the golden snapshot in `packages/ai` (`artifact-golden.test.ts`);
// these say how they're put together. The text kinds are the six from
// before the kit; the Site kind (125) has its own tests under `kinds/site`.

const textKinds = () =>
  builtinArtifactKinds.list().filter(
    (definition) =>
      definition.kind !== "site" &&
      definition.kind !== "document" &&
      definition.kind !== "diagram" &&
      definition.kind !== "presentation" &&
      definition.kind !== "spreadsheet" &&
      // Images (138) are written by `generate_image` only, never by hand.
      definition.kind !== "image"
  );

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
    for (const definition of textKinds()) {
      expect(Object.keys(definition.operations)).toEqual(["replace"]);
      expect(
        definition.operations.replace?.apply("before", { content: "after" })
      ).toBe("after");
      expect(definition.instructions).toBe("");
      expect(definition.editor).toBe("none");
      expect(definition.diff).toBe("text");
    }
    // Diagrams, documents, presentations, sites and spreadsheets come with
    // instructions.
    expect(
      builtinArtifactKinds.instructionFiles().map(({ source }) => source)
    ).toEqual([
      "kinds/diagram",
      "kinds/document",
      "kinds/presentation",
      "kinds/site",
      "kinds/spreadsheet",
    ]);
  });

  it("render in the runtime where they did, and the panel otherwise", () => {
    const renders = Object.fromEntries(
      builtinArtifactKinds
        .list()
        .map((definition) => [definition.kind, definition.render])
    );
    expect(renders).toEqual({
      code: { panel: "source", runtime: null },
      diagram: { panel: "diagram", runtime: null },
      document: { panel: "document", runtime: null },
      html: { panel: "frame", runtime: "html" },
      image: { panel: "image", runtime: null },
      markdown: { panel: "markdown", runtime: null },
      mermaid: { panel: "source", runtime: "mermaid" },
      presentation: {
        imports: ["react", "@workspace/slide-ui"],
        panel: "source",
        runtime: "presentation",
      },
      react: {
        imports: ["react", "react-dom"],
        panel: "source",
        runtime: "react",
      },
      site: { panel: "source", runtime: "site" },
      spreadsheet: { panel: "spreadsheet", runtime: null },
      svg: { panel: "frame", runtime: "svg" },
    });
  });

  it("let only React and presentations be annotated, only sites be published, only presentations be presented, and none call the model", () => {
    for (const definition of builtinArtifactKinds.list()) {
      expect(definition.capabilities).toEqual({
        aiCalls: false,
        annotate:
          definition.kind === "react" || definition.kind === "presentation",
        present: definition.kind === "presentation",
        share: definition.kind === "site",
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

  it("refuse a React import the runtime doesn't bundle (159)", () => {
    const app = (from: string) =>
      `import { x } from "${from}";\nexport default () => x;`;
    expect(builtinArtifactKinds.check("react", app("react"))).toEqual([]);
    expect(builtinArtifactKinds.check("react", app("react-dom"))).toEqual([]);
    expect(builtinArtifactKinds.check("react", app("recharts"))).toEqual([
      'imports "recharts", which isn\'t available here. It may import: react, react-dom',
    ]);
  });

  it("take an image only as a base64 data: URL (138)", () => {
    const png = imageDataUrl("image/png", "iVBORw0KGgo=");
    expect(builtinArtifactKinds.check("image", png)).toEqual([]);
    expect(builtinArtifactKinds.get("image")?.operations).toEqual({});
    const problem =
      "content isn't a PNG, JPEG or WebP image as a base64 data: URL";
    expect(builtinArtifactKinds.check("image", "a cat")).toEqual([problem]);
    expect(
      builtinArtifactKinds.check("image", "data:image/svg+xml;base64,PHN2Zz4=")
    ).toEqual([problem]);
    expect(
      builtinArtifactKinds.check(
        "image",
        imageDataUrl("image/png", "A".repeat(IMAGE_MAX_CHARS))
      )
    ).toContain(`content is longer than ${IMAGE_MAX_CHARS} characters`);
  });
});
