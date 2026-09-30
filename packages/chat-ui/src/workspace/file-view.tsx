"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CodeEditor } from "@workspace/code-ui/code-editor";
import { Trash2Icon, TriangleAlertIcon } from "@workspace/icons";
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
import { Skeleton } from "@workspace/ui/components/skeleton";
import { type ReactNode, useCallback, useState } from "react";

import type { OpenFile, SaveState } from "./model/editor";
import { PathTitle, ViewHeader } from "./view-header";

// The selected file in the panel's main area: an editor that saves as you
// go, what it's doing about saving, and the conflict when the agent changed
// the file first. Binary files and files over 1 MB are read-only. One header
// row (the path, then the actions) over the editor, which sits flush in the
// panel: no card inside it (070).

export interface FileViewProps {
  /** Move focus into the editor once it's ready (Enter in the file search). */
  readonly autoFocus?: boolean;
  readonly file: OpenFile;
  /** Leads the header's actions: a rendered file's Preview/Code toggle. */
  readonly modeToggle?: ReactNode;
  /** The editor took focus, as `autoFocus` asked. */
  readonly onAutoFocus?: () => void;
  readonly onDelete: () => void;
  readonly onEdit: (text: string) => void;
  readonly onOverwrite: () => void;
  readonly onReload: () => void;
  readonly onSave: () => void;
}

// A write that lands is not news; only failures speak (077). Saved says
// nothing, a quick save stays "Unsaved" until it lands, and only a slow one
// says "Saving…".
function SaveStatus({ save }: { readonly save: SaveState }) {
  switch (save.status) {
    case "saved":
      return null;
    case "dirty":
      return <Trans>Unsaved</Trans>;
    case "saving":
      return save.slow ? <Trans>Saving…</Trans> : <Trans>Unsaved</Trans>;
    case "conflict":
      return <Trans>Not saved</Trans>;
    case "error":
      return <Trans>Couldn't save</Trans>;
    default:
      return save satisfies never;
  }
}

function DeleteFile({
  onDelete,
  path,
}: {
  readonly onDelete: () => void;
  readonly path: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ask = useCallback(() => setOpen(true), []);
  const confirm = useCallback(() => {
    setOpen(false);
    onDelete();
  }, [onDelete]);
  return (
    <>
      <Button
        aria-label={t`Delete ${path}`}
        onClick={ask}
        size="icon-sm"
        title={t`Delete`}
        variant="ghost"
      >
        <Trash2Icon aria-hidden />
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete {path}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                It's removed from this chat's workspace for you and the agent.
                This can't be undone.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirm} variant="destructive">
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function FileView({
  autoFocus,
  file,
  modeToggle,
  onAutoFocus,
  onDelete,
  onEdit,
  onOverwrite,
  onReload,
  onSave,
}: FileViewProps) {
  const header = (actions?: ReactNode) => (
    <ViewHeader actions={actions}>
      <PathTitle path={file.path} />
    </ViewHeader>
  );
  switch (file.kind) {
    case "loading":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {header()}
          <div aria-busy className="flex flex-col gap-2 p-3" role="status">
            <span className="sr-only">
              <Trans>Opening {file.path}…</Trans>
            </span>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-52" />
          </div>
        </div>
      );
    case "error":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {header()}
          <p className="p-4 text-destructive text-sm" role="alert">
            {file.message}
          </p>
        </div>
      );
    case "binary":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {header(<DeleteFile onDelete={onDelete} path={file.path} />)}
          <p className="p-4 text-muted-foreground text-sm">
            <Trans>
              This is a binary file ({file.size} bytes), so it can't be shown or
              edited here.
            </Trans>
          </p>
        </div>
      );
    case "text":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {header(
            <>
              {modeToggle}
              <span
                aria-live="polite"
                className="px-1 text-muted-foreground text-xs"
              >
                {file.readOnly ? (
                  <Trans>Read-only: over 1 MB</Trans>
                ) : (
                  <SaveStatus save={file.save} />
                )}
              </span>
              <DeleteFile onDelete={onDelete} path={file.path} />
            </>
          )}
          {file.save.status === "conflict" ? (
            <Alert className="rounded-none border-x-0 border-t-0">
              <TriangleAlertIcon aria-hidden />
              <AlertTitle>
                <Trans>Changed by the agent</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  This file changed since you opened it. Reload to see the new
                  version, or overwrite it with yours.
                </Trans>
                <div className="mt-2 flex gap-2">
                  <Button onClick={onReload} size="sm" variant="outline">
                    <Trans>Reload</Trans>
                  </Button>
                  <Button onClick={onOverwrite} size="sm" variant="outline">
                    <Trans>Overwrite</Trans>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {file.save.status === "error" ? (
            <p className="px-3 py-2 text-destructive text-sm" role="alert">
              {file.save.message}
            </p>
          ) : null}
          <CodeEditor
            autoFocus={autoFocus}
            className="min-h-0 flex-1 overflow-auto"
            contents={file.opened}
            header={false}
            key={`${file.path}#${file.loadCount}`}
            onAutoFocus={onAutoFocus}
            onChange={onEdit}
            onSave={onSave}
            path={file.path}
            readOnly={file.readOnly}
          />
        </div>
      );
    default:
      return file satisfies never;
  }
}
