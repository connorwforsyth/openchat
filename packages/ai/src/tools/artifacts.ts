import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import type { Tool } from "ai";
import { z } from "zod";

import {
  type ArtifactRef,
  type ArtifactStore,
  artifactRefSchema,
} from "./artifact-content";
import { createArtifactTool } from "./registry/create-artifact";
import { toAiSdkTool } from "./registry/to-ai-sdk";
import { updateArtifactTool } from "./registry/update-artifact";

// The artifact tools are defined in the tool registry
// (`registry/create-artifact.ts` and `registry/update-artifact.ts`, 080),
// over what they share in `artifact-content.ts`. This module stays for one
// release so callers keep working: `createArtifactTools` binds both
// definitions to a chat's store and hands back the AI SDK tools.

// biome-ignore lint/performance/noBarrelFile: the old import paths keep working for one release (080).
export {
  type ArtifactRef,
  type ArtifactStore,
  type ArtifactToolOutput,
  artifactProblems,
  artifactToolOutputSchema,
  asDirective,
  type NewArtifactContent,
  type StoredArtifact,
} from "./artifact-content";
export {
  type CreateArtifactInput,
  createArtifact,
  createArtifactInputSchema,
} from "./registry/create-artifact";
export {
  type UpdateArtifactInput,
  updateArtifact,
  updateArtifactInputSchema,
} from "./registry/update-artifact";

export const CREATE_ARTIFACT_TOOL = createArtifactTool.name;
export const UPDATE_ARTIFACT_TOOL = updateArtifactTool.name;
export const ARTIFACT_TOOLS = [
  CREATE_ARTIFACT_TOOL,
  UPDATE_ARTIFACT_TOOL,
] as const;

/**
 * The chat's artifact tools over its store, keyed by the names in
 * `ARTIFACT_TOOLS`. Saves are checked against `kinds`, the built-in kinds
 * when left out.
 */
export const createArtifactTools = (
  store: ArtifactStore,
  kinds?: ArtifactKindRegistry
): Readonly<Record<(typeof ARTIFACT_TOOLS)[number], Tool>> => {
  const ports = kinds ? { kinds, store } : { store };
  return {
    [CREATE_ARTIFACT_TOOL]: toAiSdkTool(createArtifactTool, { ports }),
    [UPDATE_ARTIFACT_TOOL]: toAiSdkTool(updateArtifactTool, { ports }),
  };
};

const savedSchema = z.object({
  artifact: artifactRefSchema,
  status: z.literal("saved"),
});

/** The artifact an artifact tool's output saved; `null` for any other output. */
export const artifactRefOf = (output: unknown): ArtifactRef | null => {
  const parsed = savedSchema.safeParse(output);
  return parsed.success ? parsed.data.artifact : null;
};

/** Whether `name` is one of ours: only their results become artifact cards. */
export const isArtifactTool = (name: string): boolean =>
  (ARTIFACT_TOOLS as readonly string[]).includes(name);
