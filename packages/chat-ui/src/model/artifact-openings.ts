import type { Message } from "@workspace/contract/schemas/messages";

import type { ArtifactRefPart } from "./parts";

// The Workspace panel opens an artifact by itself when the run this page is
// watching makes one, or saves a new version of one: only as it happens, and
// only in the answer this page asked for. Artifacts already in the history,
// a stream picked up again after a reload, and another member's run all stay
// as they are. Pure, so the rules are tested without rendering.

/** A message as far as artifacts go; ids needn't be branded here. */
interface MessageLike {
  readonly id: string;
  readonly parts: Message["parts"];
}

/** What the screen has already seen of the chat's artifacts. */
export interface ArtifactWatch {
  /** Every artifact version on screen so far, as `artifactId:versionId`. */
  readonly seen: ReadonlySet<string>;
  /** The answer watched at the last look, so its last update still counts after the stream ends. */
  readonly watching: string | null;
}

const versionKey = (ref: ArtifactRefPart): string =>
  `${ref.artifactId}:${ref.versionId}`;

const artifactRefs = (message: MessageLike): ArtifactRefPart[] =>
  message.parts.filter(
    (part): part is ArtifactRefPart => part.type === "artifact-ref"
  );

/**
 * The artifact to open now, if any, and what's been seen after it. The first
 * look only takes stock. After that a version counts when it's new and sits
 * in `watchedId`, the answer this page asked for and is streaming (`null`
 * when it isn't watching one). Of several new ones, the last wins.
 */
export const watchArtifacts = (
  watch: ArtifactWatch | null,
  messages: readonly MessageLike[],
  watchedId: string | null
): { readonly open: ArtifactRefPart | null; readonly watch: ArtifactWatch } => {
  const next: ArtifactWatch = {
    seen: new Set([
      ...(watch?.seen ?? []),
      ...messages.flatMap(artifactRefs).map(versionKey),
    ]),
    watching: watchedId,
  };
  if (!watch) {
    return { open: null, watch: next };
  }
  const watched = new Set(
    [watchedId, watch.watching].filter((id) => id !== null)
  );
  const fresh = messages
    .filter((message) => watched.has(message.id))
    .flatMap(artifactRefs)
    .filter((ref) => !watch.seen.has(versionKey(ref)));
  return { open: fresh.at(-1) ?? null, watch: next };
};
