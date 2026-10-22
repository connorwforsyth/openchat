import { builtinKindDefinitions } from "./builtin";
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
  /**
   * The kinds the instance offers (`artifacts.kinds.enabled`); every
   * built-in kind when left out. A kind not here can't be made or changed;
   * its artifacts still render, from the built-in definitions.
   */
  readonly enabled?: readonly string[];
  readonly site: {
    readonly allowedOrigins: readonly string[];
    readonly enabled: boolean;
    /** Deprecated (163): sites have no stacks now, so this is ignored. */
    readonly stack?: string;
  };
}

export const instanceArtifactKinds = (
  settings: ArtifactKindSettings
): ArtifactKindRegistry => {
  const { site: _defaults, ...others } = builtinKindDefinitions;
  const offered = (kind: string) =>
    settings.enabled === undefined || settings.enabled.includes(kind);
  return createArtifactKindRegistry(
    [
      ...Object.values(others),
      ...(settings.site.enabled
        ? [siteKind({ allowedOrigins: settings.site.allowedOrigins })]
        : []),
    ].filter((definition) => offered(definition.kind))
  );
};
