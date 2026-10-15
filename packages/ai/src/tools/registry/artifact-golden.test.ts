import type { ArtifactId } from "@workspace/contract/schemas/common";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { asSchema, type Tool } from "ai";
import { describe, expect, it } from "vitest";

import { RECORDED_REPLIES } from "../../../evals/artifacts/fixtures";
import {
  artifactDirectiveSchema,
  parseArtifacts,
} from "../../../evals/artifacts/format";
import { composeInstructions } from "../../prompts/compose";
import { FRAGMENTS } from "../../prompts/generated";
import {
  type ArtifactStore,
  type ArtifactToolOutput,
  createArtifact,
  createArtifactTools,
  updateArtifact,
} from "../artifacts";
import { createArtifactTool } from "./create-artifact";
import { updateArtifactTool } from "./update-artifact";

// The golden snapshot of the artifact tools (ticket 123), written before the
// artifact framework (`@workspace/artifacts-kit`) existed and kept
// byte-identical after it: what the model is sent (names, descriptions,
// input and output schemas), the definitions' defaults, the artifacts prompt
// fragment as composed, and which content each kind accepts. Kinds moving
// onto definitions must not change any of it. If a change is intended,
// change the snapshot in the same commit and say so.

// Not `.json`: the formatter would rewrite what the test writes.
const SNAPSHOT = "./__snapshots__/artifact-golden.json.snap";

const json = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value ?? null));

/** A store that saves everything, so only validation decides the result. */
const acceptingStore = (): ArtifactStore => {
  const kinds = new Map<
    ArtifactId,
    { content: string; kind: ArtifactKind; title: string }
  >();
  return {
    list: () =>
      Promise.resolve(
        [...kinds.entries()].map(([artifactId, { kind, title }]) => ({
          artifactId,
          kind,
          title,
        }))
      ),
    read: (artifactId) =>
      Promise.resolve(kinds.get(artifactId)?.content ?? null),
    save: (input) => {
      if (input.artifactId && !kinds.has(input.artifactId)) {
        return Promise.resolve(err({ type: "not_found" as const }));
      }
      const artifactId = input.artifactId ?? newId("artifact");
      kinds.set(artifactId, {
        content: input.content,
        kind: input.kind,
        title: input.title,
      });
      return Promise.resolve(
        ok({
          artifactId,
          kind: input.kind,
          title: input.title,
          version: 1,
          versionId: newId("artifactVersion"),
        })
      );
    },
  };
};

/** What a result says about validation; ids and versions vary per run. */
const verdict = (output: ArtifactToolOutput): unknown =>
  output.status === "invalid"
    ? { problems: output.problems, status: output.status }
    : output.status;

const fence = "```";

/**
 * Content samples, each tried as every kind: the recorded eval replies, the
 * near misses for each kind's rule, and the framing edge cases (fences,
 * directive lines, whitespace) the old directive round trip had to survive.
 */
const SAMPLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.values(RECORDED_REPLIES)
      .flatMap((reply) => parseArtifacts(reply).artifacts)
      .map((artifact) => [`recorded ${artifact.identifier}`, artifact.content])
  ),
  "a fence first": `${fence}ts\nexport default 1\n${fence}`,
  "a lone close": ":::",
  "an open directive": ':::artifact{identifier="x" type="code" title="y"}',
  "angle brackets": "<>",
  "blank lines": "\n\n\n",
  "carriage returns": "graph TD\r\n  A-->B\r\n",
  "classDiagram glued": "classDiagramX",
  "default export no space": "exportdefault 1",
  "default export spaced": "export   default function App() {}",
  "default export, newline": "export\ndefault App",
  "doctype only": "<!doctype html>",
  "empty string": "",
  "html comment": "<!-- hi -->",
  "indented svg": "  \n <svg viewBox='0 0 1 1'></svg>  \n",
  "markdown with fences and directives": [
    "# Setup",
    `${fence}sh`,
    "bun install",
    fence,
    ":::",
    ':::artifact{identifier="x" type="code" title="y"}',
    fence,
  ].join("\n"),
  ...Object.fromEntries(
    [
      "graph",
      "flowchart",
      "sequenceDiagram",
      "classDiagram",
      "stateDiagram",
      "erDiagram",
      "gantt",
      "pie",
      "mindmap",
      "timeline",
      "journey",
      "gitGraph",
      "stateDiagram-v2",
    ].map((keyword) => [`mermaid ${keyword}`, `${keyword}\n  A`])
  ),
  "mermaid after a fence": `${fence}mermaid\ngraph TD\n${fence}`,
  "mermaid indented": "   \n\tgraph LR",
  "named export only": "export function App() {}",
  "one word": "hello",
  "react element default": "export default <p>hi</p>;",
  "spaces only": "   ",
  "svg after text": "text <svg></svg>",
  "svg in a fence": `${fence}svg\n<svg></svg>\n${fence}`,
  "svg self closing": "<svg/>",
  "svg trailing text": "<svg></svg> trailing",
  "svg uppercase": "<SVG></SVG>",
  "svg with attributes": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  "tab only": "\t",
  "tag uppercase": "<P>hi</P>",
  "tag with digit": "<1>",
  "text then a tag": "Hello <b>world</b>",
  "trailing fence line": `export default 1\n${fence}`,
};

const TITLES: Readonly<Record<string, string>> = {
  "200 characters": "t".repeat(200),
  "201 characters": "t".repeat(201),
  "201 with a double space": `${"t".repeat(100)}  ${"t".repeat(99)}`,
  "a brace": "a } b",
  "a newline": "first\nsecond",
  "attributes inside": 'x" type="svg',
  empty: "",
  plain: "Landing page",
  quotes: 'The "setup" notes',
  "spaces only": "   ",
  "surrounding spaces": "  padded  ",
  "tabs and newlines only": "\t\n",
};

/**
 * The kinds the tools write: every kind but `image`, which only
 * `generate_image` saves (138).
 */
const WRITTEN_KINDS = artifactDirectiveSchema.shape.type.options;
type WrittenKind = (typeof WRITTEN_KINDS)[number];

/** One valid content per kind, to update from. */
const BASES: Readonly<Record<WrittenKind, string>> = {
  code: "print(1)",
  diagram: '{"nodes":[{"id":"a","label":"A"}]}',
  document: "# Notes",
  html: "<p>hi</p>",
  markdown: "# Notes",
  mermaid: "graph TD",
  react: "export default 1",
  site: '{"files": {"index.html": "<p>hi</p>"}}',
  svg: "<svg></svg>",
};

/** `record` with each value mapped, in the same key order. */
const mapEntries = async <T, U>(
  record: Readonly<Record<string, T>>,
  map: (value: T, key: string) => Promise<U>
): Promise<Record<string, U>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(record).map(
        async ([key, value]) => [key, await map(value, key)] as const
      )
    )
  );

const tools = createArtifactTools(acceptingStore());

const modelView = (name: string, tool: Tool | undefined) => ({
  customModelOutput: typeof tool?.toModelOutput === "function",
  description: tool?.description ?? null,
  inputSchema: tool ? json(asSchema(tool.inputSchema).jsonSchema) : null,
  name,
  outputSchema: tool?.outputSchema
    ? json(asSchema(tool.outputSchema).jsonSchema)
    : null,
});

describe("the artifact tools", () => {
  it("are what they were before the artifact framework", async () => {
    const kinds = WRITTEN_KINDS;

    const created = await mapEntries(SAMPLES, (content) =>
      mapEntries(
        Object.fromEntries(kinds.map((kind) => [kind, kind])),
        (kind) =>
          createArtifact(acceptingStore(), {
            content,
            title: "Sample",
            type: kind,
          }).then(verdict)
      )
    );

    const titled = await mapEntries(
      {
        ...TITLES,
        // A bad title and bad content: the title is reported, alone.
        "empty, with bad content": "",
      },
      (title, name) =>
        createArtifact(acceptingStore(), {
          content:
            name === "empty, with bad content"
              ? "not an svg"
              : "export default 1",
          title,
          type: name === "empty, with bad content" ? "svg" : "react",
        }).then(verdict)
    );

    // `update_artifact` checks the new content against the artifact's kind.
    const updated = await mapEntries(BASES, async (baseContent, kind) => {
      const store = acceptingStore();
      const base = await createArtifact(store, {
        content: baseContent,
        title: "Base",
        type: kind as WrittenKind,
      });
      if (base.status !== "saved") {
        throw new Error(`no ${kind} base: ${JSON.stringify(base)}`);
      }
      return mapEntries(SAMPLES, (content) =>
        updateArtifact(store, {
          artifactId: base.artifact.artifactId,
          content,
        }).then(verdict)
      );
    });

    const golden = {
      definitions: [createArtifactTool, updateArtifactTool].map(
        (definition) => ({
          approval: definition.approval ?? null,
          capability: definition.capability ?? null,
          name: definition.name,
        })
      ),
      kinds,
      prompt: {
        composed: composeInstructions({ dynamic: [FRAGMENTS.artifacts] }),
        fragment: FRAGMENTS.artifacts,
      },
      tools: Object.entries(tools)
        .map(([name, tool]) => modelView(name, tool))
        .sort((a, b) => a.name.localeCompare(b.name)),
      validation: { created, titled, updated },
    };
    expect(golden.tools.map((tool) => tool.name)).toEqual([
      "create_artifact",
      "update_artifact",
    ]);

    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
      SNAPSHOT
    );
  });
});
