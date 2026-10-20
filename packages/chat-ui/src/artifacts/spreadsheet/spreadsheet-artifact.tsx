"use client";

import { useQuery } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactListItem,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { ReactNode } from "react";

import type { ArtifactSelection } from "../artifact-view";
import { useSaveDocumentVersion } from "../document/document-artifact";
import { SpreadsheetView } from "./spreadsheet-view";

// A Spreadsheet wired to the API (166), as a Document is (126): who may
// edit it, and a person's edit saved as a version (the server checks it
// again with the kind's rules), after which every view refetches.

export interface SpreadsheetArtifactProps {
  readonly actions?: ReactNode;
  readonly api: QueryUtils;
  readonly artifact: Artifact;
  readonly header: (content: ReactNode) => ReactNode;
  /** The artifact as its list row (access, owner), when the host has it. */
  readonly info?: ArtifactListItem;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly versionId?: ArtifactVersionId;
  readonly versions: readonly ArtifactVersion[];
}

export function SpreadsheetArtifact({
  actions,
  api,
  artifact,
  header,
  info,
  onSelect,
  versionId,
  versions,
}: SpreadsheetArtifactProps) {
  const detail = useQuery({
    ...api.artifacts.detail.queryOptions({ input: { id: artifact.id } }),
    enabled: info === undefined,
  });
  const known = info ?? detail.data?.artifact;
  const save = useSaveDocumentVersion(api, artifact.id);
  return (
    <SpreadsheetView
      access={known?.access ?? null}
      actions={actions}
      artifact={known ?? artifact}
      header={header}
      onSave={save}
      onSelect={onSelect}
      versionId={versionId}
      versions={versions}
    />
  );
}
