import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

import type { ArtifactKindDefinition } from "./define";
import { codeKind } from "./kinds/code";
import { diagramKind } from "./kinds/diagram/kind";
import { documentKind } from "./kinds/document/kind";
import { htmlKind } from "./kinds/html";
import { imageKind } from "./kinds/image";
import { markdownKind } from "./kinds/markdown";
import { mermaidKind } from "./kinds/mermaid";
import { presentationKind, spreadsheetKind } from "./kinds/planned";
import { reactKind } from "./kinds/react";
import { siteKind } from "./kinds/site/kind";
import { svgKind } from "./kinds/svg";
import { createArtifactKindRegistry } from "./registry";

// The kinds that ship, one per value of the contract's `ArtifactKind`
// (the `artifact.kind` column). The record makes a kind added to the
// contract without a definition a type error here.

export const builtinKindDefinitions = {
  code: codeKind,
  diagram: diagramKind,
  document: documentKind,
  html: htmlKind,
  image: imageKind,
  markdown: markdownKind,
  mermaid: mermaidKind,
  // Not built yet (164, 166): refused on save, offered nowhere.
  presentation: presentationKind,
  react: reactKind,
  // The defaults; an instance's settings make its own (`instanceArtifactKinds`).
  site: siteKind(),
  spreadsheet: spreadsheetKind,
  svg: svgKind,
} as const satisfies Readonly<Record<ArtifactKind, ArtifactKindDefinition>>;

/** Every built-in kind. Saves are checked against these. */
export const builtinArtifactKinds = createArtifactKindRegistry(
  Object.values(builtinKindDefinitions)
);
