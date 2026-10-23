"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactListItem,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import { type ReactNode, useCallback, useMemo } from "react";

import type { ArtifactSelection } from "../artifact-view";
import type { PlanEditing } from "../plan-editor";
import type { LinkTarget } from "./blocks";
import { DocumentView } from "./document-view";
import type { SaveDocumentVersion } from "./use-document-save";

// A Document wired to the API (126): who may edit it and whose it is (the
// artifact's detail, unless the host already has it), and saving a
// person's edit as a version, after which every view of the artifact
// (the panel, the page, the list) refetches.

export interface DocumentArtifactProps {
  readonly actions?: ReactNode;
  readonly api: QueryUtils;
  readonly artifact: Artifact;
  readonly editing?: PlanEditing | null;
  readonly header: (content: ReactNode) => ReactNode;
  /** The artifact as its list row (access, owner), when the host has it. */
  readonly info?: ArtifactListItem;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly versionId?: ArtifactVersionId;
  readonly versions: readonly ArtifactVersion[];
}

/** Saves a person's edit, then refreshes every artifact query. */
export const useSaveDocumentVersion = (
  api: QueryUtils,
  id: Artifact["id"]
): SaveDocumentVersion => {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(
    api.artifacts.saveVersion.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: api.artifacts.key() }),
    })
  );
  return useCallback(
    (input) => mutateAsync({ ...input, id }),
    [id, mutateAsync]
  );
};

export function DocumentArtifact({
  actions,
  api,
  artifact,
  editing,
  header,
  info,
  onSelect,
  versionId,
  versions,
}: DocumentArtifactProps) {
  const detail = useQuery({
    ...api.artifacts.detail.queryOptions({ input: { id: artifact.id } }),
    enabled: info === undefined,
  });
  const known = info ?? detail.data?.artifact;
  const canEdit = known?.access === "owner" || known?.access === "editor";
  // What the `/` menu can link to; its first page is plenty to pick from.
  const others = useQuery({
    ...api.artifacts.listAll.queryOptions({ input: {} }),
    enabled: canEdit,
  });
  const linkTargets = useMemo(
    (): readonly LinkTarget[] | undefined =>
      others.data?.items.map(({ id, kind, title }) => ({ id, kind, title })),
    [others.data]
  );
  const save = useSaveDocumentVersion(api, artifact.id);
  return (
    <DocumentView
      access={known?.access ?? null}
      actions={actions}
      artifact={known ?? artifact}
      authorName={known?.ownerName}
      editing={editing}
      header={header}
      linkTargets={linkTargets}
      onSave={save}
      onSelect={onSelect}
      versionId={versionId}
      versions={versions}
    />
  );
}
