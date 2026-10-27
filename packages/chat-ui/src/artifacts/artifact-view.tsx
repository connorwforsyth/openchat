"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { QueryUtils } from "@workspace/client/api";
import { CodeView } from "@workspace/code-ui/code-view";
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
  EllipsisIcon,
  FileTextIcon,
  PencilIcon,
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
import { type ReactNode, useCallback, useState } from "react";

import { Markdown } from "../conversation/markdown";
import {
  type ArtifactPreviewPlan,
  artifactFileName,
  previewPlan,
} from "../model/artifacts";
import { useElementWidth } from "../workspace/use-element-width";
import { Annotatable } from "./annotate/annotate-layer";
import {
  ArtifactPreview,
  PreviewUnavailable,
  SrcdocPreview,
} from "./artifact-preview";
import { DiagramArtifact } from "./diagram/diagram-artifact";
import { DiagramView } from "./diagram/diagram-view";
import { DocumentArtifact } from "./document/document-artifact";
import { DocumentView } from "./document/document-view";
import { fitArtifactHeader } from "./header-fit";
import { ImageArtifactPreview } from "./image-preview";
import { MermaidText } from "./mermaid-text";
import { type PlanEditing, PlanEditor } from "./plan-editor";
import { PresentationEditor } from "./presentation/presentation-editor";
import { isRuntimeKind } from "./runtime-protocol";
import { SpreadsheetArtifact } from "./spreadsheet/spreadsheet-artifact";
import { SpreadsheetView } from "./spreadsheet/spreadsheet-view";

// One artifact in the Workspace panel (D16, D27, 060), with its versions.
// An artifact shows as its rendered self, never its source (Connor, night 2):
// there's no Code tab, and a preview that can't draw says why instead.
// A code artifact's source is what it is, so that's what it shows. Artifacts
// stay database rows rendered on their own origin (D24), not workspace
// files. Data comes in as props, fetched by the host.
//
// One header row, like every Workspace view (070, 075): the title and the
// versions, in the host's frame (its `header`), which adds the panel's
// Close. The content sits flush under it: no card, no gutter, no second
// strip naming the file again.

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
   * HTML and SVG preview in a `srcdoc` frame, and React, Mermaid and sites
   * say they need the service.
   */
  readonly runtimeOrigin?: string | null;
  /** The version shown; omitted, the latest. */
  readonly versionId?: ArtifactVersionId;
  /** Versions of the artifact, oldest first; `undefined` while loading. */
  readonly versions: readonly ArtifactVersion[] | undefined;
}

const readOnly = () =>
  Promise.reject(new Error("This document can't be edited here."));

const plainHeader = (content: ReactNode) => (
  <div className="flex h-12 shrink-0 items-center border-b px-3">{content}</div>
);

export function ArtifactView(props: ArtifactViewProps) {
  return (
    <Annotatable {...props} header={props.header ?? plainHeader}>
      {(header) => <ArtifactViewBody {...props} header={header} />}
    </Annotatable>
  );
}

function ArtifactViewBody({
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
  // A Spreadsheet (166) is its own grid.
  if (artifact.kind === "spreadsheet" && versions && versions.length > 0) {
    return api ? (
      <SpreadsheetArtifact
        actions={actions}
        api={api}
        artifact={artifact}
        header={header}
        info={info}
        key={artifact.id}
        onSelect={onSelect}
        versionId={versionId}
        versions={versions}
      />
    ) : (
      <SpreadsheetView
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
  // A Diagram (165) is its own canvas.
  if (artifact.kind === "diagram" && versions && versions.length > 0) {
    return api ? (
      <DiagramArtifact
        api={api}
        artifact={artifact}
        header={header}
        info={info}
        key={artifact.id}
        onSelect={onSelect}
        versionId={versionId}
        versions={versions}
      />
    ) : (
      <DiagramView
        access={null}
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
        api={api}
        artifact={artifact}
        error={error}
        header={header}
        info={info}
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
  readonly preview: "frame" | "image" | "markdown";
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
    default:
      return preview satisfies never;
  }
}

/**
 * The artifact as itself, one branch per plan. A deck is drawn by `deck`,
 * which the caller builds: its view (164) is a world of its own. Code is
 * the one kind whose source is what it is.
 */
function PlannedPreview({
  artifact,
  content,
  deck,
  path,
  plan,
}: {
  readonly artifact: Artifact;
  readonly content: string;
  readonly deck: (runtimeOrigin: string | null) => ReactNode;
  readonly path: string;
  readonly plan: ArtifactPreviewPlan;
}) {
  switch (plan.type) {
    case "runtime":
      if (artifact.kind === "presentation") {
        return deck(plan.origin);
      }
      return isRuntimeKind(artifact.kind) ? (
        <ArtifactPreview
          content={content}
          fileName={path}
          kind={artifact.kind}
          runtimeOrigin={plan.origin}
          title={artifact.title}
        />
      ) : null;
    case "panel":
      return (
        <PanelPreview
          artifact={artifact}
          content={content}
          path={path}
          preview={plan.panel}
        />
      );
    case "unavailable":
      // A deck's own view says why it can't draw, and keeps what works
      // without the service (its editor, when there is one).
      return artifact.kind === "presentation" ? (
        deck(null)
      ) : (
        <PreviewUnavailable reason={plan.reason} />
      );
    case "source":
      // The title row already names it: no CodeHeader, no card.
      return (
        <CodeView
          className="rounded-none border-0"
          contents={content}
          header={false}
          path={path}
        />
      );
    default:
      return plan satisfies never;
  }
}

function ArtifactDetail({
  api,
  artifact,
  error,
  header,
  info,
  onSelect,
  runtimeOrigin,
  versionId,
  versions,
}: {
  readonly api: QueryUtils | undefined;
  readonly artifact: Artifact;
  readonly info: ArtifactListItem | undefined;
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
  const plan = previewPlan(artifact.kind, runtimeOrigin);
  // The mount point for a deck's view (164): the slides editor, which
  // presents, exports and edits it.
  const deck = useCallback(
    (origin: string | null) =>
      version ? (
        <PresentationEditor
          api={api}
          artifact={artifact}
          info={info}
          onSelect={onSelect}
          pinned={versionId !== undefined}
          runtimeOrigin={origin}
          version={version}
          versions={versions}
        />
      ) : null,
    [api, artifact, info, onSelect, version, versionId, versions]
  );

  const path = artifactFileName(
    artifact.title,
    artifact.kind,
    version?.language ?? null
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

  // A Mermaid diagram is edited as its text (night 2), where the API is:
  // an editor, not a code viewer, so it's the one switch the row keeps.
  const textEditable = artifact.kind === "mermaid" && api !== undefined;
  const [editingText, setEditingText] = useState(false);
  const saved = useCallback(
    (next: ArtifactVersion) => {
      onSelect({ artifactId: artifact.id, versionId: next.id });
      setEditingText(false);
    },
    [artifact.id, onSelect]
  );

  if (!version) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {header(
        <ArtifactHeader
          editingText={textEditable ? editingText : null}
          index={index}
          onEditingTextChange={setEditingText}
          onStep={step}
          title={artifact.title}
          versions={versions}
        />
      )}
      {error ? <ArtifactError error={error} /> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {textEditable && editingText && api ? (
          <MermaidText
            api={api}
            artifactId={artifact.id}
            key={version.id}
            onSaved={saved}
            version={version}
          />
        ) : (
          <PlannedPreview
            artifact={artifact}
            content={version.content}
            deck={deck}
            path={path}
            plan={plan}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The header row's contents: the title, then the versions, with a "…" menu
 * for them when the row is narrow (`fitArtifactHeader`), and a Mermaid
 * diagram's "Edit as text".
 */
function ArtifactHeader({
  editingText,
  index,
  onEditingTextChange,
  onStep,
  title,
  versions,
}: {
  /** Whether the diagram's text is open; `null` when it can't be edited. */
  readonly editingText: boolean | null;
  readonly index: number;
  readonly onEditingTextChange: (editing: boolean) => void;
  readonly onStep: (delta: -1 | 1) => void;
  readonly title: string;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
  // The row's middle, between whatever the host puts at either end; flex-1,
  // so its width is the room there is, whatever it shows.
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const fit = fitArtifactHeader({
    tabs: editingText === null ? 0 : 1,
    versions: versions.length > 1,
    width,
  });
  const older = useCallback(() => onStep(-1), [onStep]);
  const newer = useCallback(() => onStep(1), [onStep]);
  const toggleText = useCallback(
    () => onEditingTextChange(!editingText),
    [editingText, onEditingTextChange]
  );
  const number = versions[index]?.number ?? index + 1;
  const total = versions.length;
  const isOldest = index === 0;
  const isNewest = index >= total - 1;
  const editLabel = t`Edit as text`;

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
      {editingText === null ? null : (
        <Button
          aria-label={editLabel}
          aria-pressed={editingText}
          className="h-7 min-w-7 shrink-0 px-1.5 text-muted-foreground text-xs aria-pressed:bg-muted aria-pressed:text-foreground"
          onClick={toggleText}
          size="sm"
          title={editLabel}
          variant="ghost"
        >
          <PencilIcon aria-hidden />
          <span className={fit.tabLabels ? "inline" : "hidden"}>
            {editLabel}
          </span>
        </Button>
      )}
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
