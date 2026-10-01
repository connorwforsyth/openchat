import type { RunStart } from "@workspace/ai/ports/run-executor";
import type { ArtifactStore } from "@workspace/ai/tools/artifacts";
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
// edit (they own it, or hold an `editor` share).

export interface AttachedArtifact {
  readonly artifactId: ArtifactId;
  readonly content: string;
  /** Whether the model may make a new version of it from this chat. */
  readonly editable: boolean;
  readonly kind: ArtifactKind;
  readonly language: string | null;
  readonly title: string;
}

const QUOTE = /"/g;

/** The instructions section for attached artifacts; `undefined` for none. Pure. */
export const attachedArtifactsText = (
  attached: readonly AttachedArtifact[]
): string | undefined => {
  if (attached.length === 0) {
    return;
  }
  const blocks = attached.map((each) => {
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
  });
  return [
    "The user attached these artifacts to this chat from elsewhere. Each is its latest version. To change an editable one, call update_artifact with its id; that saves its next version, which the user sees wherever the artifact is used. A read-only one can't be changed from here: make a new artifact with create_artifact instead.",
    ...blocks,
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

/** The artifacts used in the run's chat, each at its latest version. */
export const attachedArtifactsFor = async (
  db: Db,
  run: RunStart
): Promise<readonly AttachedArtifact[]> => {
  const used = await listUsedArtifacts(db, run.conversationId);
  const found = await Promise.all(
    used.map(async (row): Promise<AttachedArtifact | null> => {
      if (row.latestVersionId === null) {
        return null;
      }
      const version = await getArtifactVersion(db, row.id, row.latestVersionId);
      if (!version.ok) {
        return null;
      }
      return {
        artifactId: row.id,
        content: version.value.content,
        editable: await editableBy(db, run, row),
        kind: row.kind,
        language: version.value.language,
        title: row.title,
      };
    })
  );
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
