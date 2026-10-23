import { z } from "zod";
import { builtinKindDefinitions } from "./builtin";
import type { Compile } from "./checks";
import { MAX_DESIGN, THEMED_KINDS } from "./kind-theme";
import { presentationKindWith } from "./kinds/presentation/kind";
import { siteKind } from "./kinds/site/kind";
import {
  type ArtifactKindRegistry,
  createArtifactKindRegistry,
} from "./registry";

// The kinds one instance offers (the proposal's "Rules come in layers"): the
// built-in definitions, with the instance's settings from app.config.yaml
// (`artifacts.kinds`) applied. Today that's the Site kind (125): whether
// it's on, and the public origins sites may load from.

export interface ArtifactKindSettings {
  readonly site: {
    readonly allowedOrigins: readonly string[];
    readonly enabled: boolean;
    /** Deprecated (163): sites have no stacks now, so this is ignored. */
    readonly stack?: string;
  };
}

/**
 * The instance's house style per kind, from its brand folder's DESIGN.md
 * files: prose only, added to the kind's guide for the model.
 */
export const artifactDesignNotesSchema = z.partialRecord(
  z.enum(THEMED_KINDS),
  z.string().max(MAX_DESIGN)
);
export type ArtifactDesignNotes = z.infer<typeof artifactDesignNotesSchema>;

export interface ArtifactKindPorts {
  /** Compiles TSX as the artifact runtime does: slides are checked with it on save. */
  readonly compileTsx?: Compile;
  readonly design?: ArtifactDesignNotes;
}

export const instanceArtifactKinds = (
  settings: ArtifactKindSettings,
  { compileTsx, design = {} }: ArtifactKindPorts = {}
): ArtifactKindRegistry => {
  const { site: _defaults, ...others } = builtinKindDefinitions;
  return createArtifactKindRegistry([
    // In place, so the kinds keep their order.
    ...Object.values({
      ...others,
      presentation: presentationKindWith({
        compile: compileTsx,
        design: design.presentation,
      }),
    }),
    ...(settings.site.enabled
      ? [
          siteKind({
            allowedOrigins: settings.site.allowedOrigins,
            design: design.site,
          }),
        ]
      : []),
  ]);
};
