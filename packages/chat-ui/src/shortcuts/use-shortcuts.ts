"use client";

import { useEffect, useRef } from "react";

import { usePlatform } from "../shell/platform";
import { isEditableTarget } from "./editable";
import { matchShortcut, type ShortcutId } from "./registry";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/**
 * Runs the handler for a registered shortcut. One window listener that
 * always sees the latest handlers, so callers can pass inline functions
 * without re-subscribing. View shortcuts are skipped while focus is in
 * something editable (or a menu or dialog, which own their keys); global
 * ones (⌘B, ⌘K) always run.
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
      // The innermost target: a window listener sees an event from inside a
      // shadow root (the Workspace panel's editor) as coming from its host.
      const target = event.composedPath()[0] ?? event.target;
      if (scope === "view" && isEditableTarget(target)) {
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
    return () => {
      window.removeEventListener("keydown", onCapture, { capture: true });
      window.removeEventListener("keydown", onBubble);
    };
  }, [enabled]);
};
