"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { QueryUtils } from "@workspace/client/api";
import { CodeView } from "@workspace/code-ui/code-view";
import { DiffView } from "@workspace/code-ui/diff-view";
import type {
  ArtifactId,
  ArtifactVersionId,
} from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactListItem,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  EllipsisIcon,
  EyeIcon,
  FileTextIcon,
  HistoryIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { Markdown } from "../conversation/markdown";
import {
  type ArtifactPreviewKind,
  artifactFileName,
  previewKind,
  versionEdit,
} from "../model/artifacts";
import { useElementWidth } from "../workspace/use-element-width";
import { ArtifactPreview, SrcdocPreview } from "./artifact-preview";
import { DocumentArtifact } from "./document/document-artifact";
import { DocumentView } from "./document/document-view";
import { fitArtifactHeader } from "./header-fit";
import { ImageArtifactPreview } from "./image-preview";
import { type PlanEditing, PlanEditor } from "./plan-editor";
import { PresentationPreview } from "./presentation-preview";
import { isRuntimeKind } from "./runtime-protocol";

// One artifact in the Workspace panel (D16, D27, 060): its preview, source
// (CodeView) and what changed since the previous version (DiffView), with
// its versions. Artifacts stay database rows rendered on their own origin
// (D24), not workspace files; the panel lists them beside the files. Data
// comes in as props, fetched by the host.
//
// One header row, like every Workspace view (070, 075): the title, the
// versions and the Preview/Code/Changes tabs, in the host's frame (its
// `header`), which adds the panel's Close. The content sits flush under it:
// no card, no gutter, no second strip naming the file again.

export interface ArtifactSelection {
  readonly artifactId: ArtifactId;
  /** `undefined` means the latest version. */
  readonly versionId?: ArtifactVersionId;
}

export interface ArtifactViewProps {
  /** The host's buttons for a document's title bar (126): Chat, Share, ⋯. */
  readonly actions?: ReactNode;
  /**
   * The API, for a Document (126) to know who may edit it and to save a
   * person's edits. Without it a document is read only.
   */
  readonly api?: QueryUtils;
  /** `undefined` when the chat has none. */
  readonly artifact: Artifact | undefined;
  /**
   * A plan being edited (106): when it's this artifact, the view is its
   * editor instead of its tabs.
   */
  readonly editing?: PlanEditing | null;
  /** A message the host can show if loading versions failed. */
  readonly error?: string | null;
  /**
   * Frames the view's one header row: the host wraps `content` (the title,
   * versions and tabs) in its own row, with what it adds (the panel's Close,
   * a way back). Without it, a plain 48px row.
   */
  readonly header?: (content: ReactNode) => ReactNode;
  /** The artifact as its list row (access, owner), when the host has it. */
  readonly info?: ArtifactListItem;
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

const readOnly = () =>
  Promise.reject(new Error("This document can't be edited here."));

const plainHeader = (content: ReactNode) => (
  <div className="flex h-12 shrink-0 items-center border-b px-3">{content}</div>
);

export function ArtifactView({
  actions,
  api,
  artifact,
  editing = null,
  error,
  header = plainHeader,
  info,
  onSelect,
  runtimeOrigin = null,
  versionId,
  versions,
}: ArtifactViewProps) {
  if (!artifact) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header(null)}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <FileTextIcon aria-hidden className="size-6 text-muted-foreground" />
          <p className="max-w-64 text-muted-foreground text-sm">
            <Trans>
              No artifacts yet. Code, pages and documents the agent makes in
              this chat show up here.
            </Trans>
          </p>
        </div>
      </div>
    );
  }

  const latest = versions?.at(-1);
  // A Document (126) is its own editor, a plan's included.
  if (artifact.kind === "document" && versions && versions.length > 0) {
    return api ? (
      <DocumentArtifact
        actions={actions}
        api={api}
        artifact={artifact}
        editing={editing}
        header={header}
        info={info}
        key={artifact.id}
        onSelect={onSelect}
        versionId={versionId}
        versions={versions}
      />
    ) : (
      <DocumentView
        access={null}
        actions={actions}
        artifact={artifact}
        header={header}
        key={artifact.id}
        onSave={readOnly}
        onSelect={onSelect}
        versionId={versionId}
        versions={versions}
      />
    );
  }
  if (editing?.artifactId === artifact.id && latest) {
    return (
      <PlanEditor
        editing={editing}
        header={header}
        initial={latest.content}
        key={latest.id}
        title={artifact.title}
      />
    );
  }
  if (versions && versions.length > 0) {
    return (
      <ArtifactDetail
        artifact={artifact}
        error={error}
        header={header}
        key={artifact.id}
        onSelect={onSelect}
        runtimeOrigin={runtimeOrigin}
        versionId={versionId}
        versions={versions}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header(<ArtifactTitle title={artifact.title} />)}
      {error ? <ArtifactError error={error} /> : null}
      {versions === undefined && !error ? (
        <div aria-busy className="flex flex-col gap-2 p-4" role="status">
          <span className="sr-only">
            <Trans>Loading artifact</Trans>
          </span>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}
    </div>
  );
}

function ArtifactTitle({ title }: { readonly title: string }) {
  return (
    <h3 className="min-w-0 flex-1 truncate font-medium text-sm" title={title}>
      {title}
    </h3>
  );
}

function ArtifactError({ error }: { readonly error: string }) {
  return (
    <p className="px-4 py-2 text-destructive text-sm" role="alert">
      {error}
    </p>
  );
}

/** What changed since the previous version; an image's versions have no lines (138). */
const editBetween = (
  kind: Artifact["kind"],
  path: string,
  previous: ArtifactVersion | undefined,
  version: ArtifactVersion | undefined
) =>
  previous && version && kind !== "image"
    ? versionEdit(path, previous.content, version.content)
    : null;

/** The preview the panel draws itself, without the runtime. */
function PanelPreview({
  artifact,
  content,
  path,
  preview,
}: {
  readonly artifact: Artifact;
  readonly content: string;
  readonly path: string;
  readonly preview: ArtifactPreviewKind;
}) {
  switch (preview) {
    case "frame":
      return (
        <SrcdocPreview
          content={content}
          kind={artifact.kind}
          title={artifact.title}
        />
      );
    case "image":
      return (
        <ImageArtifactPreview
          content={content}
          fileName={path}
          title={artifact.title}
        />
      );
    case "markdown":
      return (
        <article className="px-6 py-5 text-sm leading-relaxed">
          <Markdown>{content}</Markdown>
        </article>
      );
    case "none":
      return null;
    default:
      return preview satisfies never;
  }
}

/** The Code tab: the source, or a note for an image, which has none (138). */
function ArtifactSource({
  content,
  kind,
  path,
}: {
  readonly content: string;
  readonly kind: Artifact["kind"];
  readonly path: string;
}) {
  return kind === "image" ? (
    <p className="p-4 text-muted-foreground text-sm">
      <Trans>A generated image has no source to show.</Trans>
    </p>
  ) : (
    /* The title row already names it: no CodeHeader, no card. */
    <CodeView
      className="rounded-none border-0"
      contents={content}
      header={false}
      path={path}
    />
  );
}

function ArtifactDetail({
  artifact,
  error,
  header,
  onSelect,
  runtimeOrigin,
  versionId,
  versions,
}: {
  readonly artifact: Artifact;
  readonly error: string | null | undefined;
  readonly header: (content: ReactNode) => ReactNode;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly runtimeOrigin: string | null;
  readonly versionId: ArtifactVersionId | undefined;
  readonly versions: readonly ArtifactVersion[];
}) {
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
    () => editBetween(artifact.kind, path, previous, version),
    [artifact.kind, path, previous, version]
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
  const onView = useCallback((value: unknown) => {
    if (value === "preview" || value === "code" || value === "changes") {
      setView(value);
    }
  }, []);

  if (!version) {
    return null;
  }

  return (
    <Tabs
      className="h-full min-h-0 flex-1 gap-0"
      onValueChange={onView}
      value={view}
    >
      {header(
        <ArtifactHeader
          hasChanges={previous !== undefined}
          hasPreview={preview !== "none"}
          index={index}
          onStep={step}
          title={artifact.title}
          versions={versions}
        />
      )}
      {error ? <ArtifactError error={error} /> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {preview === "none" ? null : (
          <TabsContent className="flex min-h-0 flex-col" value="preview">
            {preview === "runtime" &&
            artifact.kind === "presentation" &&
            runtimeOrigin ? (
              // A deck presents and exports (164), so it has a view of its own.
              <PresentationPreview
                content={version.content}
                runtimeOrigin={runtimeOrigin}
                title={artifact.title}
              />
            ) : null}
            {preview === "runtime" &&
            artifact.kind !== "presentation" &&
            isRuntimeKind(artifact.kind) ? (
              <ArtifactPreview
                content={version.content}
                fileName={path}
                kind={artifact.kind}
                runtimeOrigin={runtimeOrigin}
                title={artifact.title}
              />
            ) : null}
            {preview === "runtime" ? null : (
              <PanelPreview
                artifact={artifact}
                content={version.content}
                path={path}
                preview={preview}
              />
            )}
          </TabsContent>
        )}
        <TabsContent value="code">
          <ArtifactSource
            content={version.content}
            kind={artifact.kind}
            path={path}
          />
        </TabsContent>
        <TabsContent value="changes">
          {edit ? (
            // Its own strip is the Unified/Split switch and the counts.
            <DiffView className="rounded-none border-0" edit={edit} />
          ) : (
            <p className="p-4 text-muted-foreground text-sm">
              <Trans>No changes from the previous version.</Trans>
            </p>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

/**
 * The header row's contents: the title, then the versions and the tabs, with
 * a "…" menu for the versions when the row is narrow (`fitArtifactHeader`).
 */
function ArtifactHeader({
  hasChanges,
  hasPreview,
  index,
  onStep,
  title,
  versions,
}: {
  readonly hasChanges: boolean;
  readonly hasPreview: boolean;
  readonly index: number;
  readonly onStep: (delta: -1 | 1) => void;
  readonly title: string;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
  // The row's middle, between whatever the host puts at either end; flex-1,
  // so its width is the room there is, whatever it shows.
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const fit = fitArtifactHeader({
    tabs: hasPreview ? 3 : 2,
    versions: versions.length > 1,
    width,
  });
  const older = useCallback(() => onStep(-1), [onStep]);
  const newer = useCallback(() => onStep(1), [onStep]);
  const number = versions[index]?.number ?? index + 1;
  const total = versions.length;
  const isOldest = index === 0;
  const isNewest = index >= total - 1;
  const words = fit.tabLabels ? "inline" : "hidden";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" ref={measure}>
      <ArtifactTitle title={title} />
      {fit.pager ? (
        // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields.
        <div
          aria-label={t`Versions`}
          className="flex shrink-0 items-center"
          role="group"
        >
          <Button
            aria-label={t`Older version`}
            disabled={isOldest}
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
            disabled={isNewest}
            onClick={newer}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      <TabsList
        aria-label={t`Artifact views`}
        className="h-7 shrink-0 gap-0.5 bg-transparent p-0"
      >
        {hasPreview ? (
          <ViewTab
            icon={<EyeIcon aria-hidden />}
            label={t`Preview`}
            value="preview"
            words={words}
          />
        ) : null}
        <ViewTab
          icon={<CodeIcon aria-hidden />}
          label={t`Code`}
          value="code"
          words={words}
        />
        <ViewTab
          disabled={!hasChanges}
          icon={<HistoryIcon aria-hidden />}
          label={t`Changes`}
          value="changes"
          words={words}
        />
      </TabsList>
      {fit.menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t`More artifact actions`}
                className="shrink-0"
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <EllipsisIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <Trans>
                  Version {number} of {total}
                </Trans>
              </DropdownMenuLabel>
              <DropdownMenuItem disabled={isOldest} onClick={older}>
                <ChevronLeftIcon aria-hidden />
                <Trans>Older version</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isNewest} onClick={newer}>
                <ChevronRightIcon aria-hidden />
                <Trans>Newer version</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * One of Preview, Code and Changes: a quiet segment like the files' Preview |
 * Code switch (070), an icon with its word when the row has room.
 */
function ViewTab({
  disabled = false,
  icon,
  label,
  value,
  words,
}: {
  readonly disabled?: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: View;
  readonly words: "hidden" | "inline";
}) {
  return (
    <TabsTrigger
      aria-label={label}
      className={cn(
        "h-7 min-w-7 flex-none rounded-md px-1.5 text-muted-foreground text-xs hover:bg-muted",
        // The segment's fill is the selection: no raised pill, no outline.
        "data-active:bg-muted data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-muted"
      )}
      disabled={disabled}
      title={label}
      value={value}
    >
      {icon}
      <span className={words}>{label}</span>
    </TabsTrigger>
  );
}
