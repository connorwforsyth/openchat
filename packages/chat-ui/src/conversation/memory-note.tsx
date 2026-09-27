"use client";

import { Trans } from "@lingui/react/macro";
import { BrainIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useState } from "react";

import type { MemoryUpdate } from "../model/parts";
import { useConversationActions } from "./actions";

type UndoState = "idle" | "undoing" | "undone" | "failed";

/**
 * "Memory updated · Undo" (D20): a quiet line under the message that changed
 * the user's memory. Undo restores the previous version (or clears a first
 * write); the host does the request.
 */
export function MemoryNote({ update }: { readonly update: MemoryUpdate }) {
  const { onUndoMemory } = useConversationActions();
  const [state, setState] = useState<UndoState>("idle");
  // A data part without the previous version can't be undone safely.
  const canUndo =
    onUndoMemory !== undefined && update.previousVersionId !== undefined;

  const undo = useCallback(async () => {
    setState("undoing");
    try {
      await onUndoMemory?.(update);
      setState("undone");
    } catch {
      setState("failed");
    }
  }, [onUndoMemory, update]);

  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs"
      data-slot="memory-note"
    >
      <BrainIcon aria-hidden className="size-3.5" />
      {state === "undone" ? (
        <span role="status">
          <Trans>Memory change undone</Trans>
        </span>
      ) : (
        <>
          <span>
            <Trans>Memory updated: {update.summary}</Trans>
          </span>
          {canUndo ? (
            <Button
              className="h-auto px-1 py-0 text-xs"
              disabled={state === "undoing"}
              onClick={undo}
              size="xs"
              variant="link"
            >
              <Trans>Undo</Trans>
            </Button>
          ) : null}
          {state === "failed" ? (
            <span className="text-destructive" role="alert">
              <Trans>Couldn't undo. Try again.</Trans>
            </span>
          ) : null}
        </>
      )}
    </p>
  );
}
