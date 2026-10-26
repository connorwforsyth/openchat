import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

import { builtinKindDefinitions } from "./builtin";

// The kinds people see (Connor, night 2). Two formats can be one kind to
// a person: a Mermaid artifact is a Diagram written as text, beside the
// editable flowchart `diagram`. Storage, the model and the checks keep both;
// everything people read (labels, icons, filters, starters) shows one.

const SHOWN_AS: Partial<Record<ArtifactKind, ArtifactKind>> = {
  mermaid: "diagram",
};

/** The kind `kind` is shown as. */
export const displayKind = (kind: ArtifactKind): ArtifactKind =>
  SHOWN_AS[kind] ?? kind;

/**
 * Every kind shown as `kind` is, the shown kind first: what a filter by it
 * matches. A hidden format (an old `?kind=mermaid`) filters as its kind.
 */
export const kindsShownAs = (kind: ArtifactKind): readonly ArtifactKind[] => {
  const shown = displayKind(kind);
  return (Object.keys(builtinKindDefinitions) as ArtifactKind[])
    .filter((each) => displayKind(each) === shown)
    .sort((a, b) => Number(b === shown) - Number(a === shown));
};

/** Whether `kind` is shown as itself, so it gets its own entry in a list. */
export const isDisplayedKind = (kind: ArtifactKind): boolean =>
  displayKind(kind) === kind;
