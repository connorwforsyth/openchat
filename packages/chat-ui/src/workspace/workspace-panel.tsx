"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { FileTree } from "@workspace/code-ui/file-tree";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import {
  EllipsisIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "@workspace/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  type ArtifactSelection,
  ArtifactView,
} from "../artifacts/artifact-view";
import type { WorkspaceSelection } from "../model/workspace";
import { FileView } from "./file-view";
import type { WorkspaceFilesSource } from "./model/client";
import { NewFileDialog } from "./new-file-dialog";
import { WorkspacePreview } from "./preview";
import {
  type FilesView,
  staticFiles,
  useWorkspaceFiles,
} from "./use-workspace-files";

// The chat's Workspace panel (060, D7): one list beside one main area. The
// list has the preview (when the agent recorded one), the Files tree and the
// Artifacts; the main area shows whichever is selected. Files open in an
// editor that saves as you go. There's no terminal and no port box: the
// agent runs commands and starts previews; people prompt, drop and edit.
// Load it through `LazyWorkspacePanel` (D27).

export interface WorkspaceArtifacts {
  readonly artifacts: readonly Artifact[];
  /** A message the host can show if loading versions failed. */
  readonly error?: string | null;
  /** The artifact runtime's origin (`ARTIFACTS_ORIGIN`, D24). */
  readonly runtimeOrigin?: string | null;
  /** Versions of the shown artifact, oldest first; `undefined` while loading. */
  readonly versions: readonly ArtifactVersion[] | undefined;
}

export interface WorkspacePanelProps {
  readonly artifacts: WorkspaceArtifacts;
  readonly className?: string;
  readonly files: WorkspaceFilesSource;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  /** Checks a preview answers before showing it; for tests. */
  readonly probePreview?: (url: string) => Promise<boolean>;
  /** `workspaceRevision` of the chat's messages. */
  readonly revision: number;
  /** What the main area shows. */
  readonly selection: WorkspaceSelection | null;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const { files } = props;
  return files.kind === "chat" ? (
    <ChatWorkspacePanel {...props} files={files} />
  ) : (
    <WorkspaceLayout {...props} view={staticFiles(files.kind)} />
  );
}

function ChatWorkspacePanel(
  props: WorkspacePanelProps & {
    readonly files: Extract<WorkspaceFilesSource, { kind: "chat" }>;
  }
) {
  const { files, onSelect, revision, selection } = props;
  const onSelectFile = useCallback(
    (path: string | null) => onSelect(path ? { kind: "file", path } : null),
    [onSelect]
  );
  const view = useWorkspaceFiles({
    files,
    onSelectFile,
    revision,
    selectedPath: selection?.kind === "file" ? selection.path : null,
  });
  return <WorkspaceLayout {...props} view={view} />;
}

const hasFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

function WorkspaceLayout({
  artifacts,
  className,
  onSelect,
  probePreview,
  selection,
  view,
}: WorkspacePanelProps & { readonly view: FilesView }) {
  const { t } = useLingui();
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { actions, status } = view;
  const writable = actions !== null && status.kind === "ready";

  const openNewFile = useCallback(() => setNewFileOpen(true), []);
  const importFiles = actions?.importFiles;

  // Dropping files anywhere on the panel adds them to the workspace.
  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (writable && hasFiles(event)) {
        event.preventDefault();
        setDragging(true);
      }
    },
    [writable]
  );
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }, []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      setDragging(false);
      if (writable && importFiles && hasFiles(event)) {
        event.preventDefault();
        importFiles([...event.dataTransfer.files]);
      }
    },
    [importFiles, writable]
  );

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a drop target for files; "Upload files…" in the menu does the same from the keyboard.
    <section
      aria-label={t`Workspace`}
      className={cn(
        "@container relative flex h-full min-h-0 flex-col bg-background",
        className
      )}
      data-dragging={dragging || undefined}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {status.kind === "failed" && actions ? (
        <Alert className="m-2 w-auto" variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>
            <Trans>The workspace didn't start</Trans>
          </AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            <p>
              <Trans>
                It starts again the next time you or the agent use a file.
              </Trans>
            </p>
            <Button
              className="mt-1"
              onClick={actions.refresh}
              size="sm"
              variant="outline"
            >
              <Trans>Retry</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.notice ? (
        <p className="border-b px-3 py-2 text-destructive text-sm" role="alert">
          {view.notice}
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 @lg:grid-cols-[12rem_minmax(0,1fr)] @lg:grid-rows-1 grid-rows-[minmax(0,14rem)_minmax(0,1fr)]">
        <WorkspaceList
          artifacts={artifacts.artifacts}
          onNewFile={openNewFile}
          onSelect={onSelect}
          selection={selection}
          view={view}
          writable={writable}
        />
        <div className="min-h-0 overflow-auto">
          <MainArea
            artifacts={artifacts}
            onNewFile={openNewFile}
            onSelect={onSelect}
            probePreview={probePreview}
            selection={selection}
            view={view}
            writable={writable}
          />
        </div>
      </div>
      {dragging ? (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-ring border-dashed bg-background/80 text-sm">
          <Trans>Drop to add to the workspace</Trans>
        </div>
      ) : null}
      {actions ? (
        <NewFileDialog
          onCreate={actions.create}
          onOpenChange={setNewFileOpen}
          open={newFileOpen}
        />
      ) : null}
    </section>
  );
}

function ListItem({
  current,
  icon,
  label,
  onClick,
}: {
  readonly current: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <li>
      <button
        aria-current={current ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
          current && "bg-muted font-medium"
        )}
        onClick={onClick}
        type="button"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

function WorkspaceList({
  artifacts,
  onNewFile,
  onSelect,
  selection,
  view,
  writable,
}: {
  readonly artifacts: readonly Artifact[];
  readonly onNewFile: () => void;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  readonly selection: WorkspaceSelection | null;
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const { t } = useLingui();
  const { preview } = view;
  const shownArtifact =
    selection?.kind === "artifact"
      ? (selection.artifactId ?? artifacts[0]?.id)
      : undefined;

  // Directories expand in place; only files open.
  const selectFile = useCallback(
    (selected: readonly string[]) => {
      const path = selected.at(-1);
      if (path && !path.endsWith("/")) {
        onSelect({ kind: "file", path });
      }
    },
    [onSelect]
  );
  const selectPreview = useCallback(
    () => onSelect({ kind: "preview" }),
    [onSelect]
  );

  return (
    <nav
      aria-label={t`Workspace contents`}
      className="flex min-h-0 flex-col gap-3 overflow-hidden @lg:border-e border-b @lg:border-b-0 p-2"
    >
      {preview ? (
        <ul>
          <ListItem
            current={selection?.kind === "preview"}
            icon={<GlobeIcon aria-hidden />}
            label={t`Preview · :${preview.port}`}
            onClick={selectPreview}
          />
        </ul>
      ) : null}
      <div className="flex min-h-24 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1 ps-2">
          <h3 className="font-medium text-muted-foreground text-xs">
            <Trans>Files</Trans>
          </h3>
          <Button
            aria-label={t`New file`}
            className="ms-auto"
            disabled={!writable}
            onClick={onNewFile}
            size="icon-xs"
            variant="ghost"
          >
            <PlusIcon aria-hidden />
          </Button>
          <WorkspaceMenu view={view} writable={writable} />
        </div>
        <FilesList onSelectFiles={selectFile} view={view} />
      </div>
      <div className="flex max-h-[40%] shrink-0 flex-col gap-1 overflow-auto">
        <h3 className="ps-2 font-medium text-muted-foreground text-xs">
          <Trans>Artifacts</Trans>
        </h3>
        {artifacts.length === 0 ? (
          <p className="px-2 text-muted-foreground text-xs">
            <Trans>None yet</Trans>
          </p>
        ) : (
          <ul aria-label={t`Artifacts in this chat`} className="flex flex-col">
            {artifacts.map((artifact) => (
              <ArtifactItem
                artifact={artifact}
                current={artifact.id === shownArtifact}
                key={artifact.id}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function ArtifactItem({
  artifact,
  current,
  onSelect,
}: {
  readonly artifact: Artifact;
  readonly current: boolean;
  readonly onSelect: (selection: WorkspaceSelection) => void;
}) {
  const select = useCallback(
    () => onSelect({ artifactId: artifact.id, kind: "artifact" }),
    [artifact.id, onSelect]
  );
  return (
    <ListItem
      current={current}
      icon={<FileTextIcon aria-hidden />}
      label={artifact.title}
      onClick={select}
    />
  );
}

function FilesList({
  onSelectFiles,
  view,
}: {
  readonly onSelectFiles: (paths: readonly string[]) => void;
  readonly view: FilesView;
}) {
  const { t } = useLingui();
  const { paths, status } = view;
  if (status.kind === "off") {
    return (
      <p className="px-2 text-muted-foreground text-xs">
        <Trans>Files are turned off on this server.</Trans>
      </p>
    );
  }
  if (status.kind === "starting") {
    return (
      <p className="px-2 text-muted-foreground text-xs" role="status">
        <Trans>Starting the workspace…</Trans>
      </p>
    );
  }
  if (paths === null) {
    return (
      <p className="px-2 text-muted-foreground text-xs" role="status">
        <Trans>Loading files…</Trans>
      </p>
    );
  }
  if (paths.length === 0) {
    return (
      <p className="px-2 text-muted-foreground text-xs">
        <Trans>No files yet</Trans>
      </p>
    );
  }
  return (
    <FileTree
      className="min-h-0 flex-1 rounded-md border-0 bg-transparent"
      label={t`Files`}
      onSelectionChange={onSelectFiles}
      paths={paths}
      search={false}
    />
  );
}

function WorkspaceMenu({
  view,
  writable,
}: {
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const { t } = useLingui();
  const { actions } = view;
  const [confirmReset, setConfirmReset] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const importFiles = actions?.importFiles;

  const chooseFiles = useCallback(() => upload.current?.click(), []);
  const chosen = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      importFiles?.([...(event.target.files ?? [])]);
      event.target.value = "";
    },
    [importFiles]
  );
  const askReset = useCallback(() => setConfirmReset(true), []);
  const reset = actions?.reset;
  const doReset = useCallback(() => {
    setConfirmReset(false);
    reset?.();
  }, [reset]);

  if (!actions) {
    return null;
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Workspace actions`}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={!writable} onClick={chooseFiles}>
            <UploadIcon aria-hidden />
            <Trans>Upload files…</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.refresh}>
            <RefreshCwIcon aria-hidden />
            <Trans>Refresh</Trans>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!reset}
            onClick={askReset}
            variant="destructive"
          >
            <RotateCcwIcon aria-hidden />
            <Trans>Reset workspace…</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        aria-hidden
        className="hidden"
        multiple
        onChange={chosen}
        ref={upload}
        tabIndex={-1}
        type="file"
      />
      <AlertDialog onOpenChange={setConfirmReset} open={confirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Reset the workspace?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                Every file in it is deleted and it starts again empty, for you
                and the agent. This can't be undone.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={doReset} variant="destructive">
              <Trans>Reset</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EmptyFiles({
  newChat,
  onNewFile,
  writable,
}: {
  readonly newChat: boolean;
  readonly onNewFile: () => void;
  readonly writable: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FileIcon aria-hidden className="size-6 text-muted-foreground" />
      <p className="max-w-64 text-muted-foreground text-sm">
        {newChat ? (
          <Trans>
            No files yet. Files you and the agent create will appear here.
          </Trans>
        ) : (
          <Trans>
            No files yet. Ask for one, drop a file here, or type /new-file
          </Trans>
        )}
      </p>
      <Button
        disabled={!writable}
        onClick={onNewFile}
        size="sm"
        variant="outline"
      >
        <PlusIcon aria-hidden data-icon="inline-start" />
        <Trans>New file</Trans>
      </Button>
    </div>
  );
}

function MainArea({
  artifacts,
  onNewFile,
  onSelect,
  probePreview,
  selection,
  view,
  writable,
}: {
  readonly artifacts: WorkspaceArtifacts;
  readonly onNewFile: () => void;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  readonly probePreview?: (url: string) => Promise<boolean>;
  readonly selection: WorkspaceSelection | null;
  readonly view: FilesView;
  readonly writable: boolean;
}) {
  const selectArtifact = useCallback(
    (next: ArtifactSelection) => onSelect({ kind: "artifact", ...next }),
    [onSelect]
  );
  const { actions, preview, status } = view;

  if (selection?.kind === "artifact") {
    const artifact =
      artifacts.artifacts.find((each) => each.id === selection.artifactId) ??
      artifacts.artifacts[0];
    return (
      <ArtifactView
        artifact={artifact}
        error={artifacts.error}
        onSelect={selectArtifact}
        runtimeOrigin={artifacts.runtimeOrigin}
        versionId={selection.versionId}
        versions={artifacts.versions}
      />
    );
  }
  if (selection?.kind === "preview" && preview) {
    return (
      <WorkspacePreview
        key={preview.url}
        preview={preview}
        probe={probePreview}
      />
    );
  }
  if (selection?.kind === "file" && actions) {
    return (
      <FileView
        file={view.open ?? { kind: "loading", path: selection.path }}
        onDelete={actions.deleteOpen}
        onEdit={actions.edit}
        onOverwrite={actions.overwrite}
        onReload={actions.reload}
        onSave={actions.save}
      />
    );
  }
  if (status.kind === "off") {
    return (
      <p className="p-4 text-muted-foreground text-sm">
        <Trans>Sandboxes are turned off on this server.</Trans>
      </p>
    );
  }
  if (view.paths && view.paths.length > 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        <Trans>Select a file to open it.</Trans>
      </div>
    );
  }
  return (
    <EmptyFiles
      newChat={status.kind === "new-chat"}
      onNewFile={onNewFile}
      writable={writable}
    />
  );
}
