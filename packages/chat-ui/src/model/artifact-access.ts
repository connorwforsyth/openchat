import {
  type ArtifactId,
  artifactIdSchema,
} from "@workspace/contract/schemas/common";

import type { WorkspaceSection } from "./layout";
import type { WorkspaceSelection } from "./workspace";

// Getting to artifacts (171): the address's `?artifact=`, stepping through a
// chat's artifacts, and noticing one the agent just made. Pure, so the
// chat screen's wiring is tested without rendering it.

/** The query parameter naming the artifact open in a chat's panel. */
export const ARTIFACT_PARAM = "artifact";

/** `?artifact=` as an id; anything that isn't one is no artifact. */
export const parseArtifactParam = (
  raw: string | null | undefined
): ArtifactId | null => {
  const parsed = artifactIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/**
 * The artifact the address should name: the one picked in the panel, while
 * the panel is on the artifacts. The chat's newest, shown by default, isn't
 * named, so opening the panel with A doesn't rewrite the address.
 */
export const artifactInView = (
  panel: WorkspaceSection | null,
  selection: WorkspaceSelection | null
): ArtifactId | null =>
  panel === "artifacts" && selection?.kind === "artifact"
    ? (selection.artifactId ?? null)
    : null;

/**
 * Opening an artifact is a step Back undoes; switching between artifacts or
 * closing the panel replaces the entry, so Back doesn't walk every pick.
 */
export const historyModeFor = (
  before: ArtifactId | null,
  after: ArtifactId | null
): "push" | "replace" =>
  before === null && after !== null ? "push" : "replace";

/**
 * The artifact `delta` away from `current` in the panel's order, or `null`
 * at either end. With nothing picked, the panel shows the first.
 */
export const stepArtifact = (
  ids: readonly ArtifactId[],
  current: ArtifactId | null | undefined,
  delta: -1 | 1
): ArtifactId | null => {
  if (ids.length === 0) {
    return null;
  }
  const at = current ? ids.indexOf(current) : 0;
  return ids[(at === -1 ? 0 : at) + delta] ?? null;
};

/** Ids in `ids` the chat hasn't seen yet. */
export const unseenArtifacts = (
  seen: ReadonlySet<ArtifactId>,
  ids: readonly ArtifactId[]
): readonly ArtifactId[] => ids.filter((id) => !seen.has(id));
