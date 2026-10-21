"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { PEEK_CLOSE_DELAY_MS } from "../model/layout";

// The collapsed sidebar's peek (071, from Connor's Zettelkasten): hovering
// the start edge shows the sidebar over the page, without moving it, and it
// goes 500ms after the pointer leaves. It stays while a menu or a text field
// inside it is in use, so reaching into a row's ⋯ menu (which portals
// outside the sidebar) or renaming a chat doesn't pull it away.

/** A clock port, so the timing is testable without waiting. */
export interface PeekTimers {
  readonly clear: (handle: ReturnType<typeof setTimeout>) => void;
  readonly set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export interface PeekController {
  /** Stop now (Escape, docking the sidebar). */
  readonly close: () => void;
  readonly dispose: () => void;
  /** The pointer reached the edge or the peeking sidebar. */
  readonly enter: () => void;
  /** The pointer left the peeking sidebar. */
  readonly leave: () => void;
}

export const createPeekController = ({
  delayMs = PEEK_CLOSE_DELAY_MS,
  isBusy,
  onOpenChange,
  timers,
}: {
  readonly delayMs?: number;
  /** Something inside is in use (a menu, a text field): don't close yet. */
  readonly isBusy: () => boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly timers: PeekTimers;
}): PeekController => {
  let open = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };
  const setOpen = (next: boolean) => {
    if (open !== next) {
      open = next;
      onOpenChange(next);
    }
  };
  const schedule = () => {
    cancel();
    timer = timers.set(() => {
      timer = null;
      // Busy: look again after the same wait, so it goes once the menu
      // closes or the field loses focus (if the pointer hasn't come back).
      if (isBusy()) {
        schedule();
      } else {
        setOpen(false);
      }
    }, delayMs);
  };
  return {
    close: () => {
      cancel();
      setOpen(false);
    },
    dispose: cancel,
    enter: () => {
      cancel();
      setOpen(true);
    },
    leave: () => {
      if (open) {
        schedule();
      }
    },
  };
};

const TEXT_ENTRY = 'input, textarea, [contenteditable="true"]';
// A popup trigger, not any disclosure: the section headers' folds are
// aria-expanded too, and open by default.
const OPEN_MENU = '[aria-haspopup][aria-expanded="true"], [data-popup-open]';

/** A menu opened from inside `element`, or a text field in it has focus. */
export const isPeekBusy = (element: HTMLElement | null): boolean => {
  if (!element) {
    return false;
  }
  if (element.querySelector(OPEN_MENU)) {
    return true;
  }
  const focused = document.activeElement;
  return (
    focused instanceof HTMLElement &&
    element.contains(focused) &&
    focused.matches(TEXT_ENTRY)
  );
};

const browserTimers: PeekTimers = {
  clear: (handle) => clearTimeout(handle),
  set: (run, ms) => setTimeout(run, ms),
};

/** The peek's state and its pointer handlers; off while the sidebar docks. */
export const usePeek = (
  element: RefObject<HTMLElement | null>,
  enabled: boolean
) => {
  const [open, setOpen] = useState(false);
  const controller = useRef<PeekController | null>(null);
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const created = createPeekController({
      isBusy: () => isPeekBusy(element.current),
      onOpenChange: setOpen,
      timers: browserTimers,
    });
    controller.current = created;
    return () => {
      created.dispose();
      controller.current = null;
      setOpen(false);
    };
  }, [element, enabled]);

  const enter = useCallback(() => controller.current?.enter(), []);
  const leave = useCallback(() => controller.current?.leave(), []);
  const close = useCallback(() => controller.current?.close(), []);
  return { close, enter, leave, open };
};
