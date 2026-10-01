import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

import type { ArtifactKindDefinition } from "./define";
import { codeKind } from "./kinds/code";
import { htmlKind } from "./kinds/html";
import { markdownKind } from "./kinds/markdown";
import { mermaidKind } from "./kinds/mermaid";
import { reactKind } from "./kinds/react";
import { svgKind } from "./kinds/svg";
import { createArtifactKindRegistry } from "./registry";

// The kinds that ship, one per value of the contract's `ArtifactKind`
// (the `artifact.kind` column). The record makes a kind added to the
// contract without a definition a type error here.

export const builtinKindDefinitions = {
  code: codeKind,
  html: htmlKind,
  markdown: markdownKind,
  mermaid: mermaidKind,
  react: reactKind,
  svg: svgKind,
} as const satisfies Readonly<Record<ArtifactKind, ArtifactKindDefinition>>;

/** Every built-in kind. Saves are checked against these. */
export const builtinArtifactKinds = createArtifactKindRegistry(
  Object.values(builtinKindDefinitions)
);
