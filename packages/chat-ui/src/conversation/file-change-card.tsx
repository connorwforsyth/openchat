"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { FileIcon, PencilIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback } from "react";

import type { FileChange } from "../model/tool-summary";
import { useConversationActions } from "./actions";

// A `write` or `edit` that landed: which file, created or edited, how many
// lines, and a way to open it in the Files panel. The line counts are the
// applied hunks' only; a partly rejected change says how much was left out.

export function FileChangeCard({ change }: { readonly change: FileChange }) {
  const { t } = useLingui();
  const { onOpenFile } = useConversationActions();
  const { added, path, rejected, removed } = change;
  const open = useCallback(() => onOpenFile?.(path), [onOpenFile, path]);
  const ChangeIcon = change.change === "created" ? FileIcon : PencilIcon;

  return (
    <section
      aria-label={
        change.change === "created" ? t`Created ${path}` : t`Edited ${path}`
      }
      className="not-prose flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-card-foreground text-sm"
    >
      <ChangeIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-muted-foreground">
            {change.change === "created" ? (
              <Trans>Created</Trans>
            ) : (
              <Trans>Edited</Trans>
            )}
          </span>
          <span className="min-w-0 truncate font-mono text-xs" title={path}>
            {path}
          </span>
        </p>
        {rejected > 0 ? (
          <p className="text-muted-foreground text-xs">
            <Plural
              one="# change rejected"
              other="# changes rejected"
              value={rejected}
            />
          </p>
        ) : null}
      </div>
      <p className="flex shrink-0 gap-1 font-mono text-xs tabular-nums">
        <span className="text-foreground">
          <span aria-hidden>+{added}</span>
          <span className="sr-only">
            <Plural one="# line added" other="# lines added" value={added} />
          </span>
        </span>
        <span className="text-destructive">
          <span aria-hidden>−{removed}</span>
          <span className="sr-only">
            <Plural
              one="# line removed"
              other="# lines removed"
              value={removed}
            />
          </span>
        </span>
      </p>
      {onOpenFile ? (
        <Button
          aria-label={t`Open ${path}`}
          onClick={open}
          size="xs"
          variant="outline"
        >
          <Trans>Open</Trans>
        </Button>
      ) : null}
    </section>
  );
}
