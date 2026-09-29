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
import { useCallback, useState } from "react";

import type { OpenFile, SaveState } from "./model/editor";

// The selected file in the panel's main area: an editor that saves as you
// go, what it's doing about saving, and the conflict when the agent changed
// the file first. Binary files and files over 1 MB are read-only.

export interface FileViewProps {
  readonly file: OpenFile;
  readonly onDelete: () => void;
  readonly onEdit: (text: string) => void;
  readonly onOverwrite: () => void;
  readonly onReload: () => void;
  readonly onSave: () => void;
}

function SaveStatus({ save }: { readonly save: SaveState }) {
  switch (save.status) {
    case "saved":
      return <Trans>Saved</Trans>;
    case "dirty":
      return <Trans>Unsaved changes</Trans>;
    case "saving":
      return <Trans>Saving…</Trans>;
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
  file,
  onDelete,
  onEdit,
  onOverwrite,
  onReload,
  onSave,
}: FileViewProps) {
  switch (file.kind) {
    case "loading":
      return (
        <div aria-busy className="flex flex-col gap-2 p-3" role="status">
          <span className="sr-only">
            <Trans>Opening {file.path}…</Trans>
          </span>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    case "error":
      return (
        <p className="p-4 text-destructive text-sm" role="alert">
          {file.message}
        </p>
      );
    case "binary":
      return (
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate font-mono text-xs">
              {file.path}
            </span>
            <span className="ms-auto">
              <DeleteFile onDelete={onDelete} path={file.path} />
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            <Trans>
              This is a binary file ({file.size} bytes), so it can't be shown or
              edited here.
            </Trans>
          </p>
        </div>
      );
    case "text":
      return (
        <div className="flex h-full min-h-0 flex-col gap-2 p-2">
          {file.save.status === "conflict" ? (
            <Alert>
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
            <p className="px-1 text-destructive text-sm" role="alert">
              {file.save.message}
            </p>
          ) : null}
          <CodeEditor
            className="min-h-0 flex-1 overflow-auto"
            contents={file.opened}
            headerActions={
              <>
                <span
                  aria-live="polite"
                  className="text-muted-foreground text-xs"
                >
                  {file.readOnly ? (
                    <Trans>Read-only: over 1 MB</Trans>
                  ) : (
                    <SaveStatus save={file.save} />
                  )}
                </span>
                <DeleteFile onDelete={onDelete} path={file.path} />
              </>
            }
            key={`${file.path}#${file.loadCount}`}
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
