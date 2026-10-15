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

export const createArtifactInputSchema = z.object({
  content: artifactContentSchema,
  language: artifactLanguageSchema,
  title: artifactDirectiveSchema.shape.title.describe(
    "A short title the user will recognise it by."
  ),
  type: artifactDirectiveSchema.shape.type.describe(
    "document: a rich-text document the user can edit and export, written in Markdown (prefer it for reports, plans and notes). html: one complete HTML document. react: one file with a default-exported component. svg: one <svg> element. diagram: a flowchart the user can rearrange, as JSON nodes and edges with no coordinates (see the Diagrams instructions). mermaid: Mermaid source, for sequence, class, state and other diagrams. markdown: Markdown text that is only read. code: a file in any language. site: a small website of several files, as JSON (see the Sites instructions)."
  ),
});
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

export const createArtifactTool = defineTool({
  // Saving puts something in the chat that outlives the reply, so it asks
  // first, like the workspace's file changes.
  approval: "ask",
  capability: "artifacts",
  description:
    "Create an artifact: a self-contained piece of work the user will want to keep, reuse or see rendered (a document, a web page, a React component, an SVG image, a diagram or a code file). It opens beside the chat instead of filling the reply. Use it for substantial content; keep short snippets and explanations in the reply.",
  execute: (input, { ports }: ToolContext<{ readonly ports: ArtifactPorts }>) =>
    createArtifact(ports.store, input, ports.kinds),
  input: createArtifactInputSchema,
  modelText: artifactModelText,
  name: "create_artifact",
  output: artifactToolOutputSchema,
});
