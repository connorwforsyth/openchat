import { builtinKindDefinitions } from "./builtin";
import type { Compile } from "./checks";
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

export interface ArtifactKindPorts {
  /** Compiles TSX as the artifact runtime does: slides are checked with it on save. */
  readonly compileTsx?: Compile;
}

export const instanceArtifactKinds = (
  settings: ArtifactKindSettings,
  { compileTsx }: ArtifactKindPorts = {}
): ArtifactKindRegistry => {
  const { site: _defaults, ...others } = builtinKindDefinitions;
  return createArtifactKindRegistry([
    // In place, so the kinds keep their order.
    ...Object.values({
      ...others,
      presentation: presentationKindWith({ compile: compileTsx }),
    }),
    ...(settings.site.enabled
      ? [siteKind({ allowedOrigins: settings.site.allowedOrigins })]
      : []),
  ]);
};
