import type { RunStart } from "@workspace/ai/ports/run-executor";
import type { ArtifactStore } from "@workspace/ai/tools/artifacts";
import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import type { Db } from "@workspace/db/client";
import {
  type ArtifactRow,
  artifactAccessOf,
  getArtifactVersion,
  listArtifacts,
  listUsedArtifacts,
  saveArtifactVersion,
} from "@workspace/db/queries/artifacts";
import { getRun } from "@workspace/db/queries/runs";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { err, ok } from "@workspace/shared/result";

// What a run's model reaches of the chat's artifacts. Its own artifacts are
// in the conversation already (the tool calls that made them). Artifacts
// used in it from elsewhere ("Use in chat", 124) are not, so their latest
// versions are put in the instructions, the way `@file` mentions are, and
// the store lets `update_artifact` version those the run's requester may
// edit (they own it, or hold an `editor` share). A chat's own artifact whose
// latest version a person edited (126) is put there too: the conversation
// only holds what the model wrote. Each is shown as the model writes it (a
// document as Markdown).

export interface AttachedArtifact {
  readonly artifactId: ArtifactId;
  readonly content: string;
  /** Whether the model may make a new version of it from this chat. */
  readonly editable: boolean;
  /** This chat's own artifact, which a person edited since (126). */
  readonly edited?: boolean;
  readonly kind: ArtifactKind;
  readonly language: string | null;
  readonly title: string;
}

const QUOTE = /"/g;

/** The instructions section for attached artifacts; `undefined` for none. Pure. */
export const attachedArtifactsText = (
  attached: readonly AttachedArtifact[]
): string | undefined => {
  const used = attached.filter((each) => !each.edited);
  const edited = attached.filter((each) => each.edited);
  if (attached.length === 0) {
    return;
  }
  const block = (each: AttachedArtifact) => {
    const attributes = [
      `id="${each.artifactId}"`,
      `title="${each.title.replace(QUOTE, "'")}"`,
      `type="${each.kind}"`,
      each.language ? `language="${each.language}"` : null,
      `access="${each.editable ? "editable" : "read-only"}"`,
    ]
      .filter((attribute) => attribute !== null)
      .join(" ");
    return `<artifact ${attributes}>\n${each.content}\n</artifact>`;
  };
  return [
    ...(used.length > 0
      ? [
          "The user attached these artifacts to this chat from elsewhere. Each is its latest version. To change an editable one, call update_artifact with its id; that saves its next version, which the user sees wherever the artifact is used. A read-only one can't be changed from here: make a new artifact with create_artifact instead.",
          ...used.map(block),
        ]
      : []),
    ...(edited.length > 0
      ? [
          "The user edited these artifacts of this chat since you last wrote them. Each is its latest version: work from it, not from what you wrote earlier.",
          ...edited.map(block),
        ]
      : []),
  ].join("\n\n");
};

/** Whether the run's requester may version `row` from another chat. */
const editableBy = async (
  db: Db,
  run: RunStart,
  row: ArtifactRow
): Promise<boolean> => {
  const level = await artifactAccessOf(db, row.id, {
    principals: await loadPrincipals(db, run.createdBy),
    userId: run.createdBy,
  });
  return level === "owner" || level === "editor";
};

/**
 * The artifacts used in the run's chat, and its own artifacts a person
 * edited last (126), each at its latest version, as the model reads it.
 */
export const attachedArtifactsFor = async (
  db: Db,
  run: RunStart
): Promise<readonly AttachedArtifact[]> => {
  const [used, own] = await Promise.all([
    listUsedArtifacts(db, run.conversationId),
    listArtifacts(db, run.conversationId),
  ]);
  const latest = async (row: ArtifactRow) => {
    if (row.latestVersionId === null) {
      return null;
    }
    const version = await getArtifactVersion(db, row.id, row.latestVersionId);
    return version.ok ? version.value : null;
  };
  const found = await Promise.all([
    ...used.map(async (row): Promise<AttachedArtifact | null> => {
      const version = await latest(row);
      return version
        ? {
            artifactId: row.id,
            content: builtinArtifactKinds.toModel(row.kind, version.content),
            editable: await editableBy(db, run, row),
            kind: row.kind,
            language: version.language,
            title: row.title,
          }
        : null;
    }),
    ...own.map(async (row): Promise<AttachedArtifact | null> => {
      const version = await latest(row);
      return version?.editedBy
        ? {
            artifactId: row.id,
            content: builtinArtifactKinds.toModel(row.kind, version.content),
            editable: true,
            edited: true,
            kind: row.kind,
            language: version.language,
            title: row.title,
          }
        : null;
    }),
  ]);
  return found.filter((each): each is AttachedArtifact => each !== null);
};

/** The attached artifacts as an instructions section, for the turn. */
export const attachedArtifactsSection = async (
  db: Db,
  run: RunStart
): Promise<string | undefined> =>
  attachedArtifactsText(await attachedArtifactsFor(db, run));

/**
 * The `ArtifactStore` port for one run over `@workspace/db`: the run's chat
 * is the only one it writes from, and each version points at the answer
 * being written. It reaches the chat's own artifacts and those used in it
 * that the requester may edit. The run was claimed before any tool runs,
 * so that answer exists.
 */
export const dbArtifactStore = (db: Db, run: RunStart): ArtifactStore => {
  const reachable = async () => {
    const [own, used] = await Promise.all([
      listArtifacts(db, run.conversationId),
      listUsedArtifacts(db, run.conversationId),
    ]);
    const editable = await Promise.all(
      used.map(async (row) => ((await editableBy(db, run, row)) ? row : null))
    );
    return [
      ...own,
      ...editable.filter((row): row is ArtifactRow => row !== null),
    ];
  };
  return {
    list: async () =>
      (await reachable()).map((row) => ({
        artifactId: row.id,
        kind: row.kind,
        title: row.title,
      })),
    read: async (artifactId) => {
      const row = (await reachable()).find((each) => each.id === artifactId);
      if (!row?.latestVersionId) {
        return null;
      }
      const version = await getArtifactVersion(db, row.id, row.latestVersionId);
      return version.ok ? version.value.content : null;
    },
    save: async (input) => {
      if (
        input.artifactId &&
        !(await reachable()).some((row) => row.id === input.artifactId)
      ) {
        return err({ type: "not_found" as const });
      }
      const stored = await getRun(db, run.runId);
      const saved = await saveArtifactVersion(db, {
        ...input,
        conversationId: run.conversationId,
        messageId:
          (stored.ok ? stored.value.assistantMessageId : null) ??
          run.userMessageId,
      });
      return saved.ok
        ? ok({
            artifactId: saved.value.artifact.id,
            kind: saved.value.artifact.kind,
            title: saved.value.artifact.title,
            version: saved.value.version.number,
            versionId: saved.value.version.id,
          })
        : err({ type: "not_found" as const });
    },
  };
};
