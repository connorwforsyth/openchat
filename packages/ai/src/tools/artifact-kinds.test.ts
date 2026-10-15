import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { importsAllowed } from "@workspace/artifacts-kit/checks";
import { defineArtifactKind } from "@workspace/artifacts-kit/define";
import { reactKind } from "@workspace/artifacts-kit/kinds/react";
import { createArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import { ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { RECORDED_REPLIES } from "../../evals/artifacts/fixtures";
import {
  artifactDirectiveSchema,
  parseArtifacts,
} from "../../evals/artifacts/format";
import { composeInstructions } from "../prompts/compose";
import { FRAGMENTS } from "../prompts/generated";
import {
  type ArtifactStore,
  artifactProblems,
  asDirective,
  createArtifactTools,
  type NewArtifactContent,
} from "./artifacts";

// The artifact tools validate through each kind's definition
// (`@workspace/artifacts-kit`, 123). Before the kit, a call was written out
// as an `:::artifact` directive and read back with the eval's strict reader;
// these tests hold the two to the same answer, and show a kind's checks
// deciding a save. The golden snapshot (`registry/artifact-golden.test.ts`)
// pins the tools themselves.

const LINE_PREFIX = /^line \d+: /;

/** What the tools said before the kit: the directive, read back strictly. */
const directiveProblems = (artifact: Parameters<typeof asDirective>[0]) =>
  parseArtifacts(asDirective(artifact)).problems.map((problem) =>
    problem.replace(LINE_PREFIX, "")
  );

const fence = "```";

const CONTENTS = [
  ...Object.values(RECORDED_REPLIES).flatMap((reply) =>
    parseArtifacts(reply).artifacts.map((artifact) => artifact.content)
  ),
  "",
  " ",
  "\n\t\n",
  "hello",
  "<>",
  "<p>hi</p>",
  "<!doctype html>",
  "<svg></svg>",
  "  <svg viewBox='0 0 1 1'>\n</svg>\n",
  "<svg/>",
  "<svg></svg> and more",
  "export default 1",
  "export\n  default App",
  "exportdefault",
  "graph TD\n  A-->B",
  "  sequenceDiagram",
  "journey\n  A",
  "stateDiagram-v2",
  `${fence}\ngraph TD\n${fence}`,
  `${fence}svg\n<svg></svg>\n${fence}`,
  `export default 1\n${fence}`,
  `:::\n:::artifact{identifier="x" type="code" title="y"}\n${fence}`,
  "line one\r\nline two\r\n",
];

const TITLES = [
  "Page",
  "",
  "   ",
  "\t\n",
  '"quoted" title',
  "a\nb",
  "x".repeat(200),
  "x".repeat(201),
  `${"x".repeat(150)}    ${"x".repeat(50)}`,
];

describe("the kinds' checks", () => {
  it("say what the directive reader said, for every text kind, content and title", () => {
    let compared = 0;
    // Sites (125) came after the directive and have checks of their own
    // (`@workspace/artifacts-kit`'s `kinds/site`); a document (126) stores
    // JSON made from the model's Markdown, which the reader can't judge;
    // an image (138) is only ever `generate_image`'s; a presentation (164)
    // is JSON whose slides its kind checks; and spreadsheets and diagrams
    // (165–166) aren't built yet.
    const textKinds = artifactDirectiveSchema.shape.type.options.filter(
      (kind) =>
        kind !== "site" && kind !== "document" && kind !== "presentation"
    );
    for (const type of textKinds) {
      for (const content of CONTENTS) {
        for (const title of TITLES) {
          const artifact = { content, title, type };
          expect(artifactProblems(artifact), JSON.stringify(artifact)).toEqual(
            directiveProblems(artifact)
          );
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("add documents', presentations' and sites' instructions, as their own layer", () => {
    const fragment = composeInstructions({ dynamic: [FRAGMENTS.artifacts] });
    const withKinds = composeInstructions({
      dynamic: [FRAGMENTS.artifacts],
      kinds: builtinArtifactKinds.instructionFiles(),
    });
    expect(withKinds.sections).toEqual([
      ...fragment.sections,
      {
        layer: "kinds",
        source: "kinds/document",
        text: builtinArtifactKinds.get("document")?.instructions,
      },
      {
        layer: "kinds",
        source: "kinds/presentation",
        text: builtinArtifactKinds.get("presentation")?.instructions,
      },
      {
        layer: "kinds",
        source: "kinds/site",
        text: builtinArtifactKinds.get("site")?.instructions,
      },
    ]);
  });
});

/** A store that records what it was asked to save. */
const recordingStore = () => {
  const saved: NewArtifactContent[] = [];
  const store: ArtifactStore = {
    list: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
    save: (input) => {
      saved.push(input);
      return Promise.resolve(
        ok({
          artifactId: input.artifactId ?? newId("artifact"),
          kind: input.kind,
          title: input.title,
          version: 1,
          versionId: newId("artifactVersion"),
        })
      );
    },
  };
  return { saved, store };
};

const call = { context: {}, messages: [], toolCallId: "call-1" };

describe("a kind's checks", () => {
  const charts = 'import { Bar } from "recharts";\nexport default Bar;';

  it("refuses a create as a tool result the model can fix, and saves nothing", async () => {
    const { saved, store } = recordingStore();
    const tools = createArtifactTools(store);
    const output = await tools.create_artifact.execute?.(
      { content: charts, title: "Chart", type: "react" },
      call
    );
    expect(output).toEqual({
      problems: [
        'imports "recharts", which isn\'t available here. It may import: react, react-dom',
      ],
      status: "invalid",
    });
    expect(
      tools.create_artifact.toModelOutput?.({
        input: {},
        output,
        toolCallId: "call-1",
      })
    ).toEqual({
      type: "text",
      value:
        'Not saved: imports "recharts", which isn\'t available here. It may import: react, react-dom. Fix the content and call the tool again.',
    });
    expect(saved).toEqual([]);
  });

  it("checks an update against the artifact's kind", async () => {
    const { saved, store } = recordingStore();
    const artifactId: ArtifactId = newId("artifact");
    const tools = createArtifactTools({
      ...store,
      list: () =>
        Promise.resolve([{ artifactId, kind: "react", title: "Chart" }]),
    });
    expect(
      await tools.update_artifact.execute?.(
        { artifactId, content: charts },
        call
      )
    ).toMatchObject({ status: "invalid" });
    expect(saved).toEqual([]);
    expect(
      await tools.update_artifact.execute?.(
        { artifactId, content: "export default () => null;" },
        call
      )
    ).toMatchObject({ status: "saved" });
    expect(saved).toHaveLength(1);
  });

  it("refuses more under a narrower layer, and the built-in kinds still accept it", async () => {
    // React that may only import React: what a narrower layer would set.
    const strictReact = defineArtifactKind({
      ...reactKind,
      checks: [...reactKind.checks, importsAllowed(["react"])],
    });
    const kinds = createArtifactKindRegistry([
      ...builtinArtifactKinds.list().filter((kind) => kind.kind !== "react"),
      strictReact,
    ]);
    const portal =
      'import { createPortal } from "react-dom";\nexport default createPortal;';
    const input = { content: portal, title: "Portal", type: "react" } as const;
    const { saved, store } = recordingStore();
    expect(
      await createArtifactTools(store, kinds).create_artifact.execute?.(
        input,
        call
      )
    ).toEqual({
      problems: [
        'imports "react-dom", which isn\'t available here. It may import: react',
      ],
      status: "invalid",
    });
    expect(saved).toEqual([]);
    expect(
      await createArtifactTools(store).create_artifact.execute?.(input, call)
    ).toMatchObject({ status: "saved" });
    expect(saved).toHaveLength(1);
  });
});
