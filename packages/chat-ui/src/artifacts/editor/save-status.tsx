"use client";

import { Trans } from "@lingui/react/macro";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleIcon,
  LoaderCircleIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

import type { VersionSaveState } from "./use-version-save";

// Whether a person's edits to an artifact are kept, in the editor's title
// bar (shared by every kind's editor): saved, waiting, saving, failed, or
// changed elsewhere with a choice of whose to keep. An older version says
// it's read only, with Restore.

export function SaveStatus({
  canEdit,
  onKeepMine,
  onLoadLatest,
  onRetry,
  state,
}: {
  readonly canEdit: boolean;
  readonly onKeepMine: () => void;
  readonly onLoadLatest: () => void;
  readonly onRetry: () => void;
  readonly state: VersionSaveState;
}) {
  const quiet = "shrink-0 text-muted-foreground text-xs";
  if (!canEdit) {
    return (
      <span className={quiet}>
        <Trans>Read only</Trans>
      </span>
    );
  }
  switch (state) {
    case "saved":
      return (
        <output
          className={cn(quiet, "inline-flex items-center gap-1")}
          data-save-state={state}
        >
          <CheckIcon aria-hidden className="size-3.5" />
          <span className="sr-only sm:not-sr-only">
            <Trans>Saved</Trans>
          </span>
        </output>
      );
    case "unsaved":
      return (
        <output
          className={cn(quiet, "inline-flex items-center gap-1")}
          data-save-state={state}
        >
          <CircleIcon aria-hidden className="size-2 fill-current" />
          <span className="sr-only sm:not-sr-only">
            <Trans>Edited</Trans>
          </span>
        </output>
      );
    case "saving":
      return (
        <output
          className={cn(quiet, "inline-flex items-center gap-1")}
          data-save-state={state}
        >
          <LoaderCircleIcon
            aria-hidden
            className="size-3.5 motion-safe:animate-spin"
          />
          <span className="sr-only sm:not-sr-only">
            <Trans>Saving…</Trans>
          </span>
        </output>
      );
    case "error":
      return (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-destructive text-xs"
          data-save-state={state}
          role="alert"
        >
          <CircleAlertIcon aria-hidden className="size-3.5" />
          <Trans>Couldn't save</Trans>
          <Button onClick={onRetry} size="xs" variant="ghost">
            <Trans>Retry</Trans>
          </Button>
        </span>
      );
    case "conflict":
      return (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs"
          data-save-state={state}
          role="alert"
        >
          <CircleAlertIcon aria-hidden className="size-3.5 text-destructive" />
          <Trans>Changed elsewhere</Trans>
          <Button onClick={onLoadLatest} size="xs" variant="ghost">
            <Trans>Load theirs</Trans>
          </Button>
          <Button onClick={onKeepMine} size="xs" variant="outline">
            <Trans>Keep mine</Trans>
          </Button>
        </span>
      );
    default:
      return state satisfies never;
  }
}

export function OlderVersion({
  canRestore,
  number,
  onLatest,
  onRestore,
}: {
  readonly canRestore: boolean;
  readonly number: number;
  /** Shows the latest version, where edits go. */
  readonly onLatest?: () => void;
  readonly onRestore: () => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      <Trans>Version {number}, read only</Trans>
      {onLatest ? (
        <Button onClick={onLatest} size="xs" variant="ghost">
          <Trans>Go to latest</Trans>
        </Button>
      ) : null}
      {canRestore ? (
        <Button onClick={onRestore} size="xs" variant="outline">
          <Trans>Restore</Trans>
        </Button>
      ) : null}
    </span>
  );
}
