"use client";

import { onDesktopMenuCommand } from "@workspace/shortcuts/desktop";
import { useEffect, useRef } from "react";

import { usePlatform } from "../shell/platform";
import {
  isTypingEvent,
  matchShortcut,
  type ShortcutId,
  shortcutIdSchema,
} from "./registry";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/**
 * Runs the handler for a registered shortcut. One window listener that
 * always sees the latest handlers, so callers can pass inline functions
 * without re-subscribing. View shortcuts are skipped while focus is in
 * something editable (or a menu or dialog, which own their keys); global
 * ones (⌘B, ⌘K) always run. In the desktop shell the native menu's item for
 * a shortcut runs its handler too (117), wherever focus is.
 */
export const useShortcuts = (
  handlers: ShortcutHandlers,
  enabled = true
): void => {
  const { isApple } = usePlatform();
  const latest = useRef({ handlers, isApple });
  useEffect(() => {
    latest.current = { handlers, isApple };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handle = (event: KeyboardEvent, scope: "global" | "view") => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      const shortcut = matchShortcut(event, latest.current.isApple);
      if (!shortcut || shortcut.scope !== scope) {
        return;
      }
      // Through shadow roots: the Workspace panel's editor is inside one.
      if (scope === "view" && isTypingEvent(event)) {
        return;
      }
      const handler = latest.current.handlers[shortcut.id];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    // Global chords (⌘B, ⌘K) are the app's even inside the editor, which
    // would otherwise claim them; catch them on the way down. Single keys
    // wait for the way up, so anything focused gets them first.
    const onCapture = (event: KeyboardEvent) => handle(event, "global");
    const onBubble = (event: KeyboardEvent) => handle(event, "view");
    window.addEventListener("keydown", onCapture, { capture: true });
    window.addEventListener("keydown", onBubble);
    const fromMenu = shortcutIdSchema.options.map((id) =>
      onDesktopMenuCommand(id, () => latest.current.handlers[id]?.())
    );
    return () => {
      window.removeEventListener("keydown", onCapture, { capture: true });
      window.removeEventListener("keydown", onBubble);
      for (const unsubscribe of fromMenu) {
        unsubscribe();
      }
    };
  }, [enabled]);
};
