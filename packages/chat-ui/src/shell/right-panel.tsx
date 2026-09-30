"use client";

import { useLingui } from "@lingui/react/macro";
import { XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  deepActiveElement,
  escapeAction,
  focusReturnTarget,
  takesFocusOnOpen,
} from "../workspace/model/focus";

// The right panel's frame (ticket 009, 060, 070). It has no title bar of its
// own: the Workspace panel's header rows carry Close (070 removed the stacked
// "Workspace" bar). What it keeps is focus: opening moves focus in, Escape
// closes when nothing inside wants it, and closing hands focus back to what
// opened the panel (Connor's Zettelkasten does the same).

export interface RightPanelProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
}

interface PanelFrame {
  readonly close: () => void;
  /** Holds focus while the panel's content loads; content takes it from here. */
  readonly frame: RefObject<HTMLDivElement | null>;
}

const PanelFrameContext = createContext<PanelFrame | null>(null);

/** The frame around the content, when it's in one (not in demos and tests). */
export const usePanelFrame = (): PanelFrame | null =>
  useContext(PanelFrameContext);

export function RightPanel({ children, onClose }: RightPanelProps) {
  const { t } = useLingui();
  const frame = useRef<HTMLDivElement | null>(null);
  // The header's toggle has the same label; it's where focus goes back to
  // when the panel was opened with S from nowhere in particular.
  const toggleLabel = t`Workspace`;
  const toggle = useRef(toggleLabel);
  useEffect(() => {
    toggle.current = toggleLabel;
  });

  // On attach: remember what had focus and take it, unless someone is
  // typing elsewhere. On detach, which React does before the frame leaves
  // the document (so focus inside it still shows): hand focus back.
  const attach = useCallback((node: HTMLDivElement | null) => {
    frame.current = node;
    if (!node) {
      return;
    }
    const doc = node.ownerDocument;
    const opener = deepActiveElement(doc);
    if (takesFocusOnOpen(opener)) {
      node.focus({ preventScroll: true });
    }
    return () => {
      frame.current = null;
      const target = focusReturnTarget({
        active: deepActiveElement(doc),
        fallback: doc.querySelector(
          `[data-slot="app-header"] button[aria-pressed][aria-label="${CSS.escape(toggle.current)}"]`
        ),
        frame: node,
        opener,
      });
      target?.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const node = event.currentTarget;
      switch (escapeAction(event.nativeEvent, node)) {
        case "close":
          event.preventDefault();
          onClose();
          return;
        case "leave-field":
          event.preventDefault();
          node.focus({ preventScroll: true });
          return;
        case "ignore":
          return;
        default:
          return;
      }
    },
    [onClose]
  );

  const context = useMemo(() => ({ close: onClose, frame }), [onClose]);
  return (
    <PanelFrameContext.Provider value={context}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape anywhere in the panel closes it; the keys belong to the controls inside. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: as above. */}
      <div
        className="flex h-full min-h-0 flex-col outline-none"
        data-slot="right-panel"
        onKeyDown={onKeyDown}
        ref={attach}
        tabIndex={-1}
      >
        {children}
      </div>
    </PanelFrameContext.Provider>
  );
}

/** Close, for the header row at the panel's top end; nothing outside a frame. */
export function ClosePanelButton({
  className,
}: {
  readonly className?: string;
}) {
  const { t } = useLingui();
  const panel = usePanelFrame();
  if (!panel) {
    return null;
  }
  return (
    <Button
      aria-label={t`Close panel`}
      className={cn("shrink-0", className)}
      onClick={panel.close}
      size="icon-sm"
      variant="ghost"
    >
      <XIcon aria-hidden />
    </Button>
  );
}
