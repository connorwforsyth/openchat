"use client";

import { useLingui } from "@lingui/react/macro";
import { useToastManager } from "@workspace/ui/components/toast";
import { useCallback } from "react";

/** How long an undo stays on offer. */
export const UNDO_TIMEOUT_MS = 6000;

/**
 * Shows "<what happened> · Undo" (D28: the change already applied
 * optimistically; undo reverses it). Needs the shell's toast provider.
 */
export const useUndoToast = () => {
  const { t } = useLingui();
  const { add, close } = useToastManager();
  return useCallback(
    ({
      onClose,
      onUndo,
      title,
    }: {
      /** The toast went away (timed out, dismissed or undone). */
      readonly onClose?: () => void;
      readonly onUndo: () => void;
      readonly title: string;
    }) => {
      const id = add({
        actionProps: {
          children: t`Undo`,
          onClick: () => {
            onUndo();
            close(id);
          },
        },
        onClose,
        priority: "low",
        timeout: UNDO_TIMEOUT_MS,
        title,
      });
      return id;
    },
    [add, close, t]
  );
};
