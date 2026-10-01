import { builtinKindDefinitions } from "./builtin";
import type { SiteStackId } from "./kinds/site/content";
import { siteKind } from "./kinds/site/kind";
import {
  type ArtifactKindRegistry,
  createArtifactKindRegistry,
} from "./registry";

// The kinds one instance offers (the proposal's "Rules come in layers"): the
// built-in definitions, with the instance's settings from app.config.yaml
// (`artifacts.kinds`) applied. Today that's the Site kind (125): whether
// it's on, its stack, and the public origins sites may load from.

export interface ArtifactKindSettings {
  readonly site: {
    readonly allowedOrigins: readonly string[];
    readonly enabled: boolean;
    readonly stack: SiteStackId;
  };
}

export const instanceArtifactKinds = (
  settings: ArtifactKindSettings
): ArtifactKindRegistry => {
  const { site: _defaults, ...others } = builtinKindDefinitions;
  return createArtifactKindRegistry([
    ...Object.values(others),
    ...(settings.site.enabled
      ? [
          siteKind({
            allowedOrigins: settings.site.allowedOrigins,
            stack: settings.site.stack,
          }),
        ]
      : []),
  ]);
};
