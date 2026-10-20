import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { builtinKindDefinitions } from "@workspace/artifacts-kit/builtin";
import {
  type ArtifactKindDefinition,
  starterKindsOf,
} from "@workspace/artifacts-kit/define";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

// The artifact kinds as people read them (124). Everything else about a kind
// (its icon, how it renders, what it exports) is its definition in
// `@workspace/artifacts-kit`; the kit's labels are plain English, so the
// names shown here go through Lingui, keyed by kind.

export const artifactKindLabels: Readonly<
  Record<ArtifactKind, MessageDescriptor>
> = {
  code: msg`Code`,
  diagram: msg`Diagram`,
  document: msg`Document`,
  html: msg`Web page`,
  image: msg`Generated image`,
  markdown: msg`Markdown`,
  mermaid: msg`Mermaid diagram`,
  presentation: msg`Presentation`,
  react: msg`React component`,
  site: msg`Site`,
  spreadsheet: msg`Spreadsheet`,
  svg: msg`SVG image`,
};

/**
 * A "Make something new" card's name where it isn't the kind's (161):
 * people make "Slides" (164), and get a presentation.
 */
export const starterLabels: Readonly<
  Partial<Record<ArtifactKind, MessageDescriptor>>
> = {
  presentation: msg`Slides`,
};

/** Every kind, in the kit's order. */
export const artifactKinds = Object.keys(
  builtinKindDefinitions
) as ArtifactKind[];

export const artifactKindDefinition = (
  kind: ArtifactKind
): ArtifactKindDefinition => builtinKindDefinitions[kind];

/**
 * The kinds "Make something new" offers (161): of `enabled` (the instance's
 * kinds; every built-in one by default), those whose definition has a
 * `starter`, in its order.
 */
export const starterKinds = (
  enabled: readonly ArtifactKind[] = artifactKinds
): readonly ArtifactKind[] =>
  starterKindsOf(
    artifactKinds
      .filter((kind) => enabled.includes(kind))
      .map((kind) => ({ kind, starter: builtinKindDefinitions[kind].starter }))
  ).map((each) => each.kind);
