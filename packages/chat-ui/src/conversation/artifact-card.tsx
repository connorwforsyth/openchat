"use client";

import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";

import { KindLabel, kindIcon } from "../artifacts/kind-icon";
import type { ArtifactRefPart } from "../model/parts";
import { useConversationActions } from "./actions";

/** A reference to an artifact the message made; opens it in the Artifacts panel. */
export function ArtifactCard({ part }: { readonly part: ArtifactRefPart }) {
  const { t } = useLingui();
  const { onOpenArtifact } = useConversationActions();
  const open = useCallback(
    () => onOpenArtifact?.(part),
    [onOpenArtifact, part]
  );
  // The kinds' own names and icons, as the panel and the Artifacts page
  // show them.
  const Icon = kindIcon(part.kind);
  return (
    <button
      aria-label={t`Open artifact: ${part.title}`}
      className="flex w-full max-w-sm items-center gap-3 rounded-lg border px-3 py-2 text-start outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
      disabled={!onOpenArtifact}
      onClick={open}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-sm">{part.title}</span>
        <span className="text-muted-foreground text-xs">
          <KindLabel kind={part.kind} />
        </span>
      </span>
    </button>
  );
}
