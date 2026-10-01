import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { importsAllowed } from "@workspace/artifacts-kit/checks";
import { defineArtifactKind } from "@workspace/artifacts-kit/define";
import { reactKind } from "@workspace/artifacts-kit/kinds/react";
import { createArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
import { newId } from "@workspace/shared/ids";
import { ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { RECORDED_REPLIES } from "../../evals/artifacts/fixtures";
import { parseArtifacts } from "../../evals/artifacts/format";
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
  it("say what the directive reader said, for every kind, content and title", () => {
    let compared = 0;
    for (const type of artifactKindSchema.options) {
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

  it("add no instructions to the artifacts prompt fragment", () => {
    const fragment = composeInstructions({ dynamic: [FRAGMENTS.artifacts] });
    const withKinds = composeInstructions({
      dynamic: [
        FRAGMENTS.artifacts,
        ...builtinArtifactKinds.instructionFiles(),
      ],
    });
    expect(withKinds).toEqual(fragment);
  });
});

/** A store that records what it was asked to save. */
const recordingStore = () => {
  const saved: NewArtifactContent[] = [];
  const store: ArtifactStore = {
    list: () => Promise.resolve([]),
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

describe("a kind with stricter checks", () => {
  // React that may only import React: what a narrower layer would set.
  const strictReact = defineArtifactKind({
    ...reactKind,
    checks: [
      ...reactKind.checks,
      importsAllowed(reactKind.render.imports ?? []),
    ],
  });
  const kinds = createArtifactKindRegistry([
    ...builtinArtifactKinds.list().filter((kind) => kind.kind !== "react"),
    strictReact,
  ]);
  const charts = 'import { Bar } from "recharts";\nexport default Bar;';

  it("refuses a create as a tool result the model can fix, and saves nothing", async () => {
    const { saved, store } = recordingStore();
    const tools = createArtifactTools(store, kinds);
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
    const tools = createArtifactTools(
      {
        ...store,
        list: () =>
          Promise.resolve([{ artifactId, kind: "react", title: "Chart" }]),
      },
      kinds
    );
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

  it("still saves what the built-in kinds accept", async () => {
    const { saved, store } = recordingStore();
    const output = await createArtifactTools(store).create_artifact.execute?.(
      { content: charts, title: "Chart", type: "react" },
      call
    );
    expect(output).toMatchObject({ status: "saved" });
    expect(saved).toHaveLength(1);
  });
});
