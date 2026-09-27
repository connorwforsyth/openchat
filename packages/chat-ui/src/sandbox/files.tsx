"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CodeView } from "@workspace/code-ui/code-view";
import { FileTree } from "@workspace/code-ui/file-tree";
import { FileIcon, RefreshCwIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback } from "react";

// The sandbox's files: a tree on one side, the selected file on the other.
// Read-only here; the agent's edits arrive as reviewable diffs (D16).

export type OpenFile =
  | { readonly kind: "text"; readonly content: string; readonly path: string }
  | { readonly kind: "binary"; readonly path: string; readonly size: number }
  | { readonly kind: "loading"; readonly path: string }
  | { readonly kind: "error"; readonly message: string; readonly path: string };

export interface SandboxFilesProps {
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onSelect: (path: string) => void;
  readonly open: OpenFile | null;
  readonly paths: readonly string[];
}

const OpenFileView = ({ open }: { readonly open: OpenFile | null }) => {
  if (open === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm">
        <FileIcon aria-hidden className="size-5" />
        <Trans>Select a file to view it.</Trans>
      </div>
    );
  }
  switch (open.kind) {
    case "text":
      return (
        <CodeView
          className="h-full overflow-auto"
          contents={open.content}
          path={open.path}
        />
      );
    case "binary":
      return (
        <p className="p-4 text-muted-foreground text-sm">
          <Trans>
            {open.path} is a binary file ({open.size} bytes) and can't be shown.
          </Trans>
        </p>
      );
    case "loading":
      return (
        <p className="p-4 text-muted-foreground text-sm">
          <Trans>Opening {open.path}…</Trans>
        </p>
      );
    case "error":
      return <p className="p-4 text-destructive text-sm">{open.message}</p>;
    default:
      return open satisfies never;
  }
};

export function SandboxFiles({
  loading,
  onRefresh,
  onSelect,
  open,
  paths,
}: SandboxFilesProps) {
  const { t } = useLingui();
  // Directories expand in place; only files open.
  const selectFile = useCallback(
    (selected: readonly string[]) => {
      const path = selected.at(-1);
      if (path && !path.endsWith("/")) {
        onSelect(path);
      }
    },
    [onSelect]
  );
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(0,1.5fr)]">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs">
          <Trans>Workspace</Trans>
        </span>
        <Button
          aria-label={t`Refresh files`}
          disabled={loading}
          onClick={onRefresh}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon
            aria-hidden
            className={loading ? "animate-spin" : undefined}
          />
        </Button>
      </div>
      {paths.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">
          {loading ? (
            <Trans>Loading files…</Trans>
          ) : (
            <Trans>The workspace is empty.</Trans>
          )}
        </p>
      ) : (
        <FileTree
          className="h-full border-b"
          label={t`Sandbox files`}
          onSelectionChange={selectFile}
          paths={paths}
          search={false}
        />
      )}
      <div className="min-h-0 overflow-auto">
        <OpenFileView open={open} />
      </div>
    </div>
  );
}
