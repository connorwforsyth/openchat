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
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useMemo, useState } from "react";

import { Markdown } from "../conversation/markdown";
import {
  artifactFileName,
  frameDocument,
  previewKind,
  versionEdit,
} from "../model/artifacts";

// The Artifacts panel (D16, D27): the chat's artifacts, one at a time, with
// its versions. Preview, source (CodeView) and what changed since the
// previous version (DiffView). Load it through `LazyArtifactsPanel`; data
// comes in as props, fetched by the host.

export interface ArtifactSelection {
  readonly artifactId: ArtifactId;
  /** `undefined` means the latest version. */
  readonly versionId?: ArtifactVersionId;
}

export interface ArtifactsPanelProps {
  readonly artifacts: readonly Artifact[];
  /** A message the host can show if loading versions failed. */
  readonly error?: string | null;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly selection: ArtifactSelection | null;
  /** Versions of the selected artifact, oldest first; `undefined` while loading. */
  readonly versions: readonly ArtifactVersion[] | undefined;
}

type View = "preview" | "code" | "changes";

export function ArtifactsPanel({
  artifacts,
  error,
  onSelect,
  selection,
  versions,
}: ArtifactsPanelProps) {
  const { t } = useLingui();
  const selected =
    artifacts.find((artifact) => artifact.id === selection?.artifactId) ??
    artifacts[0];

  if (!selected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileTextIcon aria-hidden className="size-6 text-muted-foreground" />
        <p className="max-w-64 text-muted-foreground text-sm">
          <Trans>
            Nothing here yet. Code, pages and documents the agent makes in this
            chat show up here.
          </Trans>
        </p>
      </div>
    );
  }

  return (
    <section aria-label={t`Artifacts`} className="flex h-full min-h-0 flex-col">
      {artifacts.length > 1 ? (
        <ul
          aria-label={t`Artifacts in this chat`}
          className="flex flex-col gap-px border-b p-2"
        >
          {artifacts.map((artifact) => (
            <ArtifactListItem
              active={artifact.id === selected.id}
              artifact={artifact}
              key={artifact.id}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
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
          artifact={selected}
          key={selected.id}
          onSelect={onSelect}
          selection={selection}
          versions={versions}
        />
      ) : null}
    </section>
  );
}

function ArtifactListItem({
  active,
  artifact,
  onSelect,
}: {
  readonly active: boolean;
  readonly artifact: Artifact;
  readonly onSelect: (selection: ArtifactSelection) => void;
}) {
  const select = useCallback(
    () => onSelect({ artifactId: artifact.id }),
    [artifact.id, onSelect]
  );
  return (
    <li>
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          active && "bg-muted font-medium"
        )}
        onClick={select}
        type="button"
      >
        <FileTextIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{artifact.title}</span>
      </button>
    </li>
  );
}

function ArtifactDetail({
  artifact,
  onSelect,
  selection,
  versions,
}: {
  readonly artifact: Artifact;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly selection: ArtifactSelection | null;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
  const index = Math.max(
    0,
    selection?.versionId
      ? versions.findIndex((candidate) => candidate.id === selection.versionId)
      : versions.length - 1
  );
  const version = versions[index] ?? versions.at(-1);
  const previous = index > 0 ? versions[index - 1] : undefined;
  const preview = previewKind(artifact.kind);
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
            {preview === "frame" ? (
              // TODO(025): serve previews from a separate origin so a page
              // can't reach this one; `srcdoc` plus `allow-scripts` (and no
              // `allow-same-origin`) gives it an opaque origin until then.
              <iframe
                className="size-full min-h-80 rounded-lg border bg-background"
                sandbox="allow-scripts"
                srcDoc={frameDocument(artifact.kind, version.content)}
                title={t`Preview of ${artifact.title}`}
              />
            ) : (
              <div className="text-sm">
                <Markdown>{version.content}</Markdown>
              </div>
            )}
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
