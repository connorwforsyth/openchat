"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  type Diagram,
  diagramContentSchema,
  serializeDiagram,
} from "@workspace/artifacts-kit/kinds/diagram/schema";
import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactAccess,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  PlusIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { ReactFlowProvider } from "@xyflow/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ArtifactSelection } from "../artifact-view";
import { OlderVersion, SaveStatus } from "../document/document-view";
import {
  type SaveDocumentVersion,
  useDocumentSave,
} from "../document/use-document-save";
import { DiagramCanvas, type DiagramCanvasHandle } from "./diagram-canvas";
import { exportMermaid, exportPicture } from "./export";
import { addNode } from "./flow";

// A Diagram artifact (165): a title bar (the title, its versions, whether
// edits are saved, Export) over the canvas. A person's edit (a drag, a new
// label, an edge, a delete, a new node) saves a new version after a pause,
// through the same path and checks as a document's (126). Older versions
// open read only, with Restore.

export interface DiagramViewProps {
  /** The caller's access: an owner or editor edits; anyone else reads. `null` while unknown. */
  readonly access: ArtifactAccess | null;
  readonly artifact: Artifact;
  /** Frames the title bar in the host's row (the panel adds Close). */
  readonly header: (content: ReactNode) => ReactNode;
  readonly onSave: SaveDocumentVersion;
  readonly onSelect: (selection: ArtifactSelection) => void;
  /** The version shown; omitted, the latest. */
  readonly versionId?: ArtifactVersionId;
  /** Every version, oldest first. */
  readonly versions: readonly ArtifactVersion[];
}

const readDiagram = (content: string): Diagram | null => {
  const parsed = diagramContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
};

export function DiagramView({
  access,
  artifact,
  header,
  onSave,
  onSelect,
  versionId,
  versions,
}: DiagramViewProps) {
  const latest = versions.at(-1);
  // As a document's: the latest version picked follows new ones.
  const pickedIndex = versionId
    ? versions.findIndex((each) => each.id === versionId)
    : -1;
  const follows = versionId === undefined || versionId === latest?.id;
  const index = follows || pickedIndex < 0 ? versions.length - 1 : pickedIndex;
  const shown = versions[index] ?? latest;
  if (!(latest && shown)) {
    return null;
  }
  const isLatest = shown.id === latest.id;
  const mayEdit = access === "owner" || access === "editor";
  return (
    <ReactFlowProvider>
      <DiagramVersion
        artifact={artifact}
        canEdit={mayEdit && isLatest}
        header={header}
        index={index}
        // The latest stays mounted while it's edited; an older version is
        // its own read-only canvas.
        key={isLatest ? "latest" : shown.id}
        latest={latest}
        mayEdit={mayEdit}
        onSave={onSave}
        onSelect={onSelect}
        shown={shown}
        versions={versions}
      />
    </ReactFlowProvider>
  );
}

function DiagramVersion({
  artifact,
  canEdit,
  header,
  index,
  latest,
  mayEdit,
  onSave,
  onSelect,
  shown,
  versions,
}: Omit<DiagramViewProps, "access" | "versionId"> & {
  readonly canEdit: boolean;
  readonly index: number;
  readonly latest: ArtifactVersion;
  readonly mayEdit: boolean;
  readonly shown: ArtifactVersion;
}) {
  const { t } = useLingui();
  const [diagram, setDiagram] = useState(() => readDiagram(shown.content));
  const save = useDocumentSave({ baseVersionId: latest.id, save: onSave });
  const { change, saved: isMine, state } = save;
  const canvas = useRef<DiagramCanvasHandle>(null);

  const edit = useCallback(
    (next: Diagram) => {
      setDiagram(next);
      change(serializeDiagram(next));
    },
    [change]
  );

  // A version made elsewhere (the model, another editor) shows at once when
  // nothing here waits to be saved; otherwise the save reports a conflict.
  const latestShown = useRef(latest.id);
  useEffect(() => {
    if (latestShown.current === latest.id || shown.id !== latest.id) {
      return;
    }
    latestShown.current = latest.id;
    if (isMine(latest.id) || state !== "saved") {
      return;
    }
    setDiagram(readDiagram(latest.content));
  }, [isMine, latest, shown.id, state]);

  const loadLatest = useCallback(() => {
    setDiagram(readDiagram(latest.content));
    save.reset(latest.id);
  }, [latest, save]);
  const keepMine = useCallback(
    () => save.keepMine(latest.id),
    [latest.id, save]
  );
  const retry = useCallback(() => {
    save.flush().catch(() => undefined);
  }, [save]);
  const restore = useCallback(() => {
    onSave({ baseVersionId: latest.id, content: shown.content })
      .then((version) =>
        onSelect({ artifactId: artifact.id, versionId: version.id })
      )
      .catch(() => undefined);
  }, [artifact.id, latest.id, onSave, onSelect, shown.content]);

  const newLabel = t`New step`;
  const add = useCallback(() => {
    if (diagram) {
      edit(addNode(diagram, newLabel).diagram);
    }
  }, [diagram, edit, newLabel]);

  const exports = useMemo(
    () => ({
      mermaid: () => {
        if (diagram) {
          exportMermaid(diagram, artifact.title);
        }
      },
      png: () => {
        const picture = canvas.current?.picture();
        if (picture) {
          exportPicture(picture, artifact.title, "png").catch(() => undefined);
        }
      },
      svg: () => {
        const picture = canvas.current?.picture();
        if (picture) {
          exportPicture(picture, artifact.title, "svg").catch(() => undefined);
        }
      },
    }),
    [artifact.title, diagram]
  );

  const isLatest = shown.id === latest.id;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {header(
        <TitleBar
          artifact={artifact}
          exports={exports}
          index={index}
          onSelect={onSelect}
          status={
            isLatest ? (
              <SaveStatus
                canEdit={canEdit}
                onKeepMine={keepMine}
                onLoadLatest={loadLatest}
                onRetry={retry}
                state={state}
              />
            ) : (
              <OlderVersion
                canRestore={mayEdit}
                number={shown.number}
                onRestore={restore}
              />
            )
          }
          versions={versions}
        />
      )}
      {diagram ? (
        <DiagramCanvas
          diagram={diagram}
          editable={canEdit}
          handle={canvas}
          label={t`Diagram: ${artifact.title}`}
          onChange={edit}
          toolbar={
            canEdit ? (
              <Button onClick={add} size="sm" variant="outline">
                <PlusIcon aria-hidden data-icon="inline-start" />
                <Trans>Add node</Trans>
              </Button>
            ) : null
          }
        />
      ) : (
        <p className="p-4 text-destructive text-sm" role="alert">
          <Trans>This version couldn't be read as a diagram.</Trans>
        </p>
      )}
    </div>
  );
}

function TitleBar({
  artifact,
  exports,
  index,
  onSelect,
  status,
  versions,
}: {
  readonly artifact: Artifact;
  readonly exports: Readonly<Record<"mermaid" | "png" | "svg", () => void>>;
  readonly index: number;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly status: ReactNode;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
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
  const number = versions[index]?.number ?? index + 1;
  const total = versions.length;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <h2
        className="min-w-0 flex-1 truncate font-medium text-sm"
        title={artifact.title}
      >
        {artifact.title}
      </h2>
      {total > 1 ? (
        // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields.
        <div
          aria-label={t`Versions`}
          className="hidden shrink-0 items-center sm:flex"
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
            className="min-w-14 text-center text-muted-foreground text-xs tabular-nums"
          >
            <Trans>
              v{number} of {total}
            </Trans>
          </span>
          <Button
            aria-label={t`Newer version`}
            disabled={index >= total - 1}
            onClick={newer}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      {status}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Export`}
              size="sm"
              title={t`Export`}
              variant="ghost"
            />
          }
        >
          <DownloadIcon aria-hidden data-icon="inline-start" />
          <span className="hidden md:inline">
            <Trans>Export</Trans>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={exports.svg}>
              <Trans>SVG image (.svg)</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exports.png}>
              <Trans>PNG image (.png)</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exports.mermaid}>
              <Trans>Mermaid (.mmd)</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
