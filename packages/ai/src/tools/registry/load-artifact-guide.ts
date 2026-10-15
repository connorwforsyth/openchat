import { z } from "zod";

import { LOAD_ARTIFACT_GUIDE_TOOL } from "../../prompts/artifact-guides";
import { defineTool, type ToolContext } from "./define";

// `load_artifact_guide` (160): our `quickstart`. A turn with it is told each
// artifact kind in one line, and loads the kind's instructions and library
// guide (Sites' `@workspace/site-ui` components, say) before it writes one.
// It reads only the kinds this instance offers, with the instance's settings
// already applied (a site's allowed origins), so it never asks.

export const loadArtifactGuideInputSchema = z.object({
  type: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe('The artifact kind you are about to write, such as "site".'),
});
export type LoadArtifactGuideInput = z.infer<
  typeof loadArtifactGuideInputSchema
>;

export const loadArtifactGuideOutputSchema = z.discriminatedUnion("status", [
  z.object({
    guide: z.string(),
    status: z.literal("loaded"),
    type: z.string(),
  }),
  z.object({ available: z.array(z.string()), status: z.literal("not_found") }),
]);
export type LoadArtifactGuideOutput = z.infer<
  typeof loadArtifactGuideOutputSchema
>;

export const artifactGuideSchema = z.object({
  /** The kind's full instructions, its library guide included. */
  guide: z.string(),
  kind: z.string(),
});
export type ArtifactGuide = z.infer<typeof artifactGuideSchema>;

export interface ArtifactGuidePorts {
  /** The guides of the kinds this turn may create; kinds without one are left out. */
  readonly guides: readonly ArtifactGuide[];
}

/** Applies a `load_artifact_guide` call against the turn's kinds. */
export const loadArtifactGuide = (
  ports: ArtifactGuidePorts,
  input: LoadArtifactGuideInput
): LoadArtifactGuideOutput => {
  const wanted = input.type.toLowerCase();
  const found = ports.guides.find((each) => each.kind.toLowerCase() === wanted);
  return found
    ? { guide: found.guide, status: "loaded", type: found.kind }
    : { available: ports.guides.map((each) => each.kind), status: "not_found" };
};

/** What the model reads: the guide as text, not JSON. */
export const loadArtifactGuideModelText = (
  output: LoadArtifactGuideOutput
): string => {
  switch (output.status) {
    case "loaded":
      return `<artifact-guide type="${output.type}">\n${output.guide}\n</artifact-guide>`;
    case "not_found":
      return output.available.length === 0
        ? "No artifact kind here has a guide."
        : `No guide for that type. Guides: ${output.available.join(", ")}.`;
    default:
      return output satisfies never;
  }
};

export const loadArtifactGuideTool = defineTool({
  // It only reads what the instance already tells the model, so it never asks.
  approval: "auto",
  capability: "artifacts",
  description:
    "Load an artifact kind's guide: its rules and the components it builds from. Call it before you create or update an artifact of that kind.",
  execute: (
    input,
    { ports }: ToolContext<{ readonly ports: ArtifactGuidePorts }>
  ) => Promise.resolve(loadArtifactGuide(ports, input)),
  input: loadArtifactGuideInputSchema,
  modelText: loadArtifactGuideModelText,
  name: LOAD_ARTIFACT_GUIDE_TOOL,
  output: loadArtifactGuideOutputSchema,
});
