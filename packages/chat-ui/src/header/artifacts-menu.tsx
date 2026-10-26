"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import type { Artifact } from "@workspace/contract/schemas/files";
import { formatRelativeTime } from "@workspace/i18n/format";
import { ShapesIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useCallback, useMemo } from "react";

import { KindLabel, kindIcon } from "../artifacts/kind-icon";

/** The chat's artifacts, the one changed last first. Pure. */
export const artifactsByChange = (
  artifacts: readonly Artifact[]
): readonly Artifact[] =>
  [...artifacts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export interface ArtifactsMenuProps {
  readonly artifacts: readonly Artifact[];
  /** The artifact the panel shows, ticked in the list. */
  readonly current: ArtifactId | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (artifact: Artifact) => void;
  readonly open: boolean;
}

/**
 * The header's Artifacts button (night 2, after T3 Code's top-right list):
 * a popover of the chat's artifacts, one compact row each, that opens the
 * one picked in the panel. The panel itself holds no list of artifacts.
 * Opens from the button, A, and the ⌘K palette; Escape closes it.
 */
export function ArtifactsMenu({
  artifacts,
  current,
  onOpenChange,
  onPick,
  open,
}: ArtifactsMenuProps) {
  const { t } = useLingui();
  const rows = useMemo(() => artifactsByChange(artifacts), [artifacts]);
  const count = artifacts.length;
  const now = open ? Date.now() : 0;
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={t`Artifacts`}
            className="gap-1 px-2 aria-expanded:bg-muted"
            size="sm"
            title={t`Artifacts`}
            variant="ghost"
          />
        }
      >
        <ShapesIcon aria-hidden />
        {count > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <Command loop>
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <h2 className="font-medium text-sm">
              <Trans>Artifacts in this chat</Trans>
            </h2>
          </div>
          {/* Typing filters; it also holds focus, so ↑/↓ and Enter work. */}
          <CommandInput
            aria-label={t`Filter artifacts`}
            placeholder={t`Filter`}
          />
          <CommandList className="max-h-96 p-1">
            <CommandEmpty className="px-3 py-4 text-start text-muted-foreground">
              {count === 0 ? (
                <Trans>
                  Nothing yet. Ask for a document, a deck, a site or a diagram
                  and it appears here.
                </Trans>
              ) : (
                <Trans>No artifact has that name.</Trans>
              )}
            </CommandEmpty>
            {rows.map((artifact) => (
              <ArtifactRow
                artifact={artifact}
                current={artifact.id === current}
                key={artifact.id}
                now={now}
                onPick={onPick}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ArtifactRow({
  artifact,
  current,
  now,
  onPick,
}: {
  readonly artifact: Artifact;
  readonly current: boolean;
  readonly now: number;
  readonly onPick: (artifact: Artifact) => void;
}) {
  const { i18n } = useLingui();
  const pick = useCallback(() => onPick(artifact), [artifact, onPick]);
  const Icon = kindIcon(artifact.kind);
  return (
    <CommandItem
      aria-current={current || undefined}
      className="items-start gap-2.5 py-2"
      data-checked={current}
      onSelect={pick}
      value={`${artifact.title} ${artifact.id}`}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{artifact.title}</span>
        <span className="truncate text-muted-foreground text-xs">
          <KindLabel kind={artifact.kind} />
          {" · "}
          {artifact.latestVersionId === null ? (
            <Trans>Making…</Trans>
          ) : (
            formatRelativeTime(artifact.updatedAt, i18n.locale, now)
          )}
        </span>
      </span>
    </CommandItem>
  );
}
