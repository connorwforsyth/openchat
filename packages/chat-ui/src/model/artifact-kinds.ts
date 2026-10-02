import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { builtinKindDefinitions } from "@workspace/artifacts-kit/builtin";
import type { ArtifactKindDefinition } from "@workspace/artifacts-kit/define";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

// The artifact kinds as people read them (124). Everything else about a kind
// (its icon, how it renders, what it exports) is its definition in
// `@workspace/artifacts-kit`; the kit's labels are plain English, so the
// names shown here go through Lingui, keyed by kind.

export const artifactKindLabels: Readonly<
  Record<ArtifactKind, MessageDescriptor>
> = {
  code: msg`Code`,
  document: msg`Document`,
  html: msg`Web page`,
  markdown: msg`Markdown`,
  mermaid: msg`Diagram`,
  react: msg`React component`,
  site: msg`Site`,
  svg: msg`SVG image`,
};

/** Every kind, in the kit's order. */
export const artifactKinds = Object.keys(
  builtinKindDefinitions
) as ArtifactKind[];

export const artifactKindDefinition = (
  kind: ArtifactKind
): ArtifactKindDefinition => builtinKindDefinitions[kind];

/**
 * The kinds "Make something new" offers: those shown as more than their
 * source (a page, a document, a diagram), not plain code. Markdown is left
 * to the model: a Document (126) is what a person starts.
 */
export const starterKinds: readonly ArtifactKind[] = artifactKinds.filter(
  (kind) => {
    const { render } = builtinKindDefinitions[kind];
    return (
      kind !== "markdown" &&
      (render.runtime !== null || render.panel !== "source")
    );
  }
);
