import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import { z } from "zod";

import { artifactDirectiveSchema } from "../../../evals/artifacts/format";
import {
  type ArtifactPorts,
  type ArtifactStore,
  type ArtifactToolOutput,
  artifactContentSchema,
  artifactLanguageSchema,
  artifactModelText,
  artifactToolOutputSchema,
  saveArtifact,
  storedContent,
} from "../artifact-content";
import { defineTool, type ToolContext } from "./define";

// `create_artifact` (078): saves a document, page or snippet as version 1
// of a new artifact; the result carries the `artifact-ref` the answer shows
// as a card. The content is checked by its kind's definition
// (`@workspace/artifacts-kit`, 123) first, and nothing is saved if a check
// fails. What the tools share is in `../artifact-content.ts`.

/** The kinds the model writes itself: not `image`, which is `generate_image`'s. */
type WrittenKind = z.infer<typeof artifactDirectiveSchema.shape.type>;

/**
 * What `type` tells the model about each kind it may write, in the order
 * it reads them. A kind the instance doesn't offer isn't mentioned.
 */
const TYPE_DESCRIPTIONS: readonly (readonly [WrittenKind, string])[] = [
  [
    "document",
    "a rich-text document the user can edit and export, written in Markdown (prefer it for reports, plans and notes).",
  ],
  ["html", "one complete HTML document."],
  ["react", "one file with a default-exported component."],
  ["svg", "one <svg> element."],
  [
    "diagram",
    "a flowchart the user can rearrange, as JSON nodes and edges with no coordinates (see the Diagrams instructions).",
  ],
  ["mermaid", "Mermaid source, for sequence, class, state and other diagrams."],
  ["markdown", "Markdown text that is only read."],
  ["code", "a file in any language."],
  [
    "site",
    "a small website of several files, as JSON (see the Sites instructions).",
  ],
  [
    "spreadsheet",
    "sheets of values and formulas, one Markdown table per sheet (see the Spreadsheets instructions).",
  ],
];

/**
 * `create_artifact`'s input for the kinds in `offered`: its `type` takes
 * only those, so a kind the instance turned off never reaches the model.
 */
export const createArtifactInputFor = (offered: readonly string[]) => {
  const kinds = artifactDirectiveSchema.shape.type.options.filter((kind) =>
    offered.includes(kind)
  );
  return z.object({
    content: artifactContentSchema,
    language: artifactLanguageSchema,
    title: artifactDirectiveSchema.shape.title.describe(
      "A short title the user will recognise it by."
    ),
    type: z.enum(kinds as [WrittenKind, ...WrittenKind[]]).describe(
      TYPE_DESCRIPTIONS.filter(([kind]) => kinds.includes(kind))
        .map(([kind, text]) => `${kind}: ${text}`)
        .join(" ")
    ),
  });
};

export const createArtifactInputSchema = createArtifactInputFor(
  artifactDirectiveSchema.shape.type.options
);
export type CreateArtifactInput = z.infer<typeof createArtifactInputSchema>;

/**
 * Applies a `create_artifact` call. Exposed for tests; the tool wraps it.
 * A kind whose versions aren't what the model writes (a document's
 * Markdown, 126) converts it first.
 */
export const createArtifact = (
  store: ArtifactStore,
  input: CreateArtifactInput,
  kinds: ArtifactKindRegistry = builtinArtifactKinds
): Promise<ArtifactToolOutput> => {
  const stored = storedContent(kinds, input.type, input.content);
  if ("problems" in stored) {
    return Promise.resolve({
      problems: [...stored.problems],
      status: "invalid",
    });
  }
  return saveArtifact(
    store,
    {
      content: stored.content,
      kind: input.type,
      language: input.language ?? null,
      title: input.title,
    },
    kinds
  );
};

/** What the tool's description names as examples, for each kind. */
const EXAMPLES: readonly (readonly [readonly string[], string])[] = [
  [["document"], "a document"],
  [["html", "site"], "a web page"],
  [["react"], "a React component"],
  [["svg"], "an SVG image"],
  [["diagram", "mermaid"], "a diagram"],
  [["code"], "a code file"],
];

/** "a document, a web page or a diagram", for the kinds offered. */
const examplesOf = (offered: readonly string[]): string => {
  const named = EXAMPLES.filter(([kinds]) =>
    kinds.some((kind) => offered.includes(kind))
  ).map(([, text]) => text);
  return named.length > 1
    ? `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`
    : (named[0] ?? "");
};

/**
 * `create_artifact` over `kinds`, the instance's: the model is offered
 * exactly the kinds it may make.
 */
export const createArtifactToolFor = (kinds: ArtifactKindRegistry) =>
  defineTool({
    // Saving puts something in the chat that outlives the reply, so it asks
    // first, like the workspace's file changes.
    approval: "ask",
    capability: "artifacts",
    description: `Create an artifact: a self-contained piece of work the user will want to keep, reuse or see rendered (${examplesOf(kinds.kinds)}). It opens beside the chat instead of filling the reply. Use it for substantial content; keep short snippets and explanations in the reply.`,
    execute: (
      input,
      { ports }: ToolContext<{ readonly ports: ArtifactPorts }>
    ) => createArtifact(ports.store, input, ports.kinds),
    input: createArtifactInputFor(kinds.kinds),
    modelText: artifactModelText,
    name: "create_artifact",
    output: artifactToolOutputSchema,
  });

/** `create_artifact` over every built-in kind. */
export const createArtifactTool = createArtifactToolFor(builtinArtifactKinds);
