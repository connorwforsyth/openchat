"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CodeView } from "@workspace/code-ui/code-view";
import { DiffView } from "@workspace/code-ui/diff-view";
import type {
  ArtifactId,
  ArtifactVersionId,
} from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useCallback, useMemo, useState } from "react";

import { Markdown } from "../conversation/markdown";
import {
  type ArtifactPreviewKind,
  artifactFileName,
  previewKind,
  versionEdit,
} from "../model/artifacts";
import { ArtifactPreview, SrcdocPreview } from "./artifact-preview";
import { isRuntimeKind } from "./runtime-protocol";

// One artifact in the Workspace panel (D16, D27, 060): its preview, source
// (CodeView) and what changed since the previous version (DiffView), with
// its versions. Artifacts stay database rows rendered on their own origin
// (D24), not workspace files; the panel lists them beside the files. Data
// comes in as props, fetched by the host.

export interface ArtifactSelection {
  readonly artifactId: ArtifactId;
  /** `undefined` means the latest version. */
  readonly versionId?: ArtifactVersionId;
}

export interface ArtifactViewProps {
  /** `undefined` when the chat has none. */
  readonly artifact: Artifact | undefined;
  /** A message the host can show if loading versions failed. */
  readonly error?: string | null;
  readonly onSelect: (selection: ArtifactSelection) => void;
  /**
   * The artifact runtime's origin (`ARTIFACTS_ORIGIN`, D24). Without one,
   * HTML and SVG preview in a `srcdoc` frame and React and Mermaid show
   * source only.
   */
  readonly runtimeOrigin?: string | null;
  /** The version shown; omitted, the latest. */
  readonly versionId?: ArtifactVersionId;
  /** Versions of the artifact, oldest first; `undefined` while loading. */
  readonly versions: readonly ArtifactVersion[] | undefined;
}

type View = "preview" | "code" | "changes";

export function ArtifactView({
  artifact,
  error,
  onSelect,
  runtimeOrigin = null,
  versionId,
  versions,
}: ArtifactViewProps) {
  if (!artifact) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileTextIcon aria-hidden className="size-6 text-muted-foreground" />
        <p className="max-w-64 text-muted-foreground text-sm">
          <Trans>
            No artifacts yet. Code, pages and documents the agent makes in this
            chat show up here.
          </Trans>
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <p className="p-3 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {versions === undefined && !error ? (
        <div aria-busy className="flex flex-col gap-2 p-3" role="status">
          <span className="sr-only">
            <Trans>Loading artifact</Trans>
          </span>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}
      {versions && versions.length > 0 ? (
        <ArtifactDetail
          artifact={artifact}
          key={artifact.id}
          onSelect={onSelect}
          runtimeOrigin={runtimeOrigin}
          versionId={versionId}
          versions={versions}
        />
      ) : null}
    </div>
  );
}

function ArtifactDetail({
  artifact,
  onSelect,
  runtimeOrigin,
  versionId,
  versions,
}: {
  readonly artifact: Artifact;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly runtimeOrigin: string | null;
  readonly versionId: ArtifactVersionId | undefined;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
  const index = Math.max(
    0,
    versionId
      ? versions.findIndex((candidate) => candidate.id === versionId)
      : versions.length - 1
  );
  const version = versions[index] ?? versions.at(-1);
  const previous = index > 0 ? versions[index - 1] : undefined;
  // The runtime previews every kind it knows; without it, what 015 could.
  const preview: ArtifactPreviewKind | "runtime" =
    runtimeOrigin && isRuntimeKind(artifact.kind)
      ? "runtime"
      : previewKind(artifact.kind);
  const [view, setView] = useState<View>(
    preview === "none" ? "code" : "preview"
  );

  const path = artifactFileName(
    artifact.title,
    artifact.kind,
    version?.language ?? null
  );
  const edit = useMemo(
    () =>
      previous && version
        ? versionEdit(path, previous.content, version.content)
        : null,
    [path, previous, version]
  );

  const step = useCallback(
    (delta: -1 | 1) => {
      const target = versions[index + delta];
      if (target) {
        onSelect({ artifactId: artifact.id, versionId: target.id });
      }
    },
    [artifact.id, index, onSelect, versions]
  );
  const older = useCallback(() => step(-1), [step]);
  const newer = useCallback(() => step(1), [step]);
  const onView = useCallback((value: unknown) => {
    if (value === "preview" || value === "code" || value === "changes") {
      setView(value);
    }
  }, []);

  if (!version) {
    return null;
  }
  const { number } = version;
  const total = versions.length;

  return (
    <Tabs className="min-h-0 flex-1 gap-0" onValueChange={onView} value={view}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate font-medium text-sm">
          {artifact.title}
        </h3>
        {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields. */}
        <div
          aria-label={t`Versions`}
          className="flex items-center"
          role="group"
        >
          <Button
            aria-label={t`Older version`}
            disabled={index === 0}
            onClick={older}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <span
            aria-live="polite"
            className="min-w-16 text-center text-muted-foreground text-xs tabular-nums"
          >
            <Trans>
              v{number} of {total}
            </Trans>
          </span>
          <Button
            aria-label={t`Newer version`}
            disabled={index >= versions.length - 1}
            onClick={newer}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </div>
      <div className="border-b px-3 py-1.5">
        <TabsList aria-label={t`Artifact views`} variant="line">
          {preview === "none" ? null : (
            <TabsTrigger value="preview">
              <Trans>Preview</Trans>
            </TabsTrigger>
          )}
          <TabsTrigger value="code">
            <Trans>Code</Trans>
          </TabsTrigger>
          <TabsTrigger disabled={!previous} value="changes">
            <Trans>Changes</Trans>
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {preview === "none" ? null : (
          <TabsContent className="h-full" value="preview">
            {preview === "runtime" && isRuntimeKind(artifact.kind) ? (
              <ArtifactPreview
                content={version.content}
                fileName={path}
                kind={artifact.kind}
                runtimeOrigin={runtimeOrigin}
                title={artifact.title}
              />
            ) : null}
            {preview === "frame" ? (
              <SrcdocPreview
                content={version.content}
                kind={artifact.kind}
                title={artifact.title}
              />
            ) : null}
            {preview === "markdown" ? (
              <div className="text-sm">
                <Markdown>{version.content}</Markdown>
              </div>
            ) : null}
          </TabsContent>
        )}
        <TabsContent value="code">
          <CodeView contents={version.content} path={path} />
        </TabsContent>
        <TabsContent value="changes">
          {edit ? (
            <DiffView edit={edit} />
          ) : (
            <p className="text-muted-foreground text-sm">
              <Trans>No changes from the previous version.</Trans>
            </p>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}
