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
import { DiagramView } from "./diagram-view";

// A Diagram wired to the API (165): who may edit it (the artifact's detail,
// unless the host already has it) and saving a person's edit as a version
// through `artifacts.saveVersion`, the path a document's edits take (126).

export interface DiagramArtifactProps {
  readonly api: QueryUtils;
  readonly artifact: Artifact;
  readonly header: (content: ReactNode) => ReactNode;
  readonly info?: ArtifactListItem;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly versionId?: ArtifactVersionId;
  readonly versions: readonly ArtifactVersion[];
}

export function DiagramArtifact({
  api,
  artifact,
  header,
  info,
  onSelect,
  versionId,
  versions,
}: DiagramArtifactProps) {
  const detail = useQuery({
    ...api.artifacts.detail.queryOptions({ input: { id: artifact.id } }),
    enabled: info === undefined,
  });
  const known = info ?? detail.data?.artifact;
  const save = useSaveDocumentVersion(api, artifact.id);
  return (
    <DiagramView
      access={known?.access ?? null}
      artifact={known ?? artifact}
      header={header}
      onSave={save}
      onSelect={onSelect}
      versionId={versionId}
      versions={versions}
    />
  );
}
