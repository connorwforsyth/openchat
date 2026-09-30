import { artifactIdSchema } from "@workspace/contract/schemas/common";
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
  type StoredArtifact,
  saveArtifact,
} from "../artifact-content";
import { defineTool, type ToolContext } from "./define";

// `update_artifact` (078): the whole content again, saved as the artifact's
// next version; earlier versions are kept. What the tools share is in
// `../artifact-content.ts`.

export const updateArtifactInputSchema = z.object({
  artifactId: artifactIdSchema.describe(
    "The artifactId create_artifact returned."
  ),
  content: artifactContentSchema,
  language: artifactLanguageSchema,
  title: artifactDirectiveSchema.shape.title
    .optional()
    .describe("A new title; leave out to keep the current one."),
});
export type UpdateArtifactInput = z.infer<typeof updateArtifactInputSchema>;

/** Applies an `update_artifact` call: the whole content again, as the next version. */
export const updateArtifact = async (
  store: ArtifactStore,
  input: UpdateArtifactInput
): Promise<ArtifactToolOutput> => {
  let existing: readonly StoredArtifact[];
  try {
    existing = await store.list();
  } catch {
    return {
      message: "The artifact couldn't be read right now.",
      status: "unavailable",
    };
  }
  const current = existing.find(
    (artifact) => artifact.artifactId === input.artifactId
  );
  if (!current) {
    return { artifacts: [...existing], status: "not_found" };
  }
  return saveArtifact(store, {
    artifactId: current.artifactId,
    content: input.content,
    kind: current.kind,
    language: input.language ?? null,
    title: input.title ?? current.title,
  });
};

export const updateArtifactTool = defineTool({
  // A new version is a change to something the user kept, so it asks first.
  approval: "ask",
  capability: "artifacts",
  description:
    "Replace an artifact's content, saved as its next version; earlier versions are kept. Pass the complete new content, not a diff.",
  execute: (input, { ports }: ToolContext<{ readonly ports: ArtifactPorts }>) =>
    updateArtifact(ports.store, input),
  input: updateArtifactInputSchema,
  modelText: artifactModelText,
  name: "update_artifact",
  output: artifactToolOutputSchema,
});
