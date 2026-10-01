"use client";

import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { clampSplit, SPLIT_KEY_STEP, splitBounds } from "./model/split";

// The divider between the browser and the files (097), the sidebar's handle
// (071, `ResizeHandle` in `@workspace/ui`) turned on its side: a WAI-ARIA
// window splitter that is an 8px hit strip showing a 1px line, darker on
// hover and while dragging, with pointer capture, no text selection while
// dragging, double-click to reset, ↑/↓ to nudge and Home/End for the limits.
// It's in shares of the panel's height rather than pixels, so a saved
// position fits a window of any height. (`ResizeHandle` only drags across;
// an `orientation` there would let the two be one.)

interface Drag {
  last: number;
  readonly pointerId: number;
  readonly startValue: number;
  readonly startY: number;
}

type SplitHandleProps = Omit<
  ComponentProps<"div">,
  "children" | "defaultValue" | "onResize" | "role"
> & {
  /** Double-click resets to this share. */
  readonly defaultValue: number;
  /** The height the halves share, in px; 0 before it's measured. */
  readonly height: number;
  /** Every change while dragging or nudging, for the live layout. */
  readonly onResize: (fraction: number) => void;
  /** A finished change (release, key press, reset): the one to keep. */
  readonly onResizeEnd: (fraction: number) => void;
  /** The upper half's share of `height`. */
  readonly value: number;
};

export function SplitHandle({
  className,
  defaultValue,
  height,
  onResize,
  onResizeEnd,
  value,
  ...props
}: SplitHandleProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const { max, min } = splitBounds(height);
  const clamp = useCallback(
    (fraction: number) => clampSplit(fraction, height),
    [height]
  );

  // Nothing else on the page selects while a drag crosses it.
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const { style } = document.documentElement;
    const previous = style.userSelect;
    style.userSelect = "none";
    return () => {
      style.userSelect = previous;
    };
  }, [dragging]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || height <= 0) {
        return;
      }
      // No text selection starts, and focus stays where it was.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        last: value,
        pointerId: event.pointerId,
        startValue: value,
        startY: event.clientY,
      };
      setDragging(true);
    },
    [height, value]
  );
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const { current } = drag;
      if (current?.pointerId !== event.pointerId) {
        return;
      }
      const next = clamp(
        current.startValue + (event.clientY - current.startY) / height
      );
      if (next !== current.last) {
        current.last = next;
        onResize(next);
      }
    },
    [clamp, height, onResize]
  );
  const endDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const { current } = drag;
      if (current?.pointerId !== event.pointerId) {
        return;
      }
      drag.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Saved once, on release, not on every pixel.
      onResizeEnd(current.last);
    },
    [onResizeEnd]
  );
  const reset = useCallback(() => {
    const next = clamp(defaultValue);
    onResize(next);
    onResizeEnd(next);
  }, [clamp, defaultValue, onResize, onResizeEnd]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = height > 0 ? SPLIT_KEY_STEP / height : 0.02;
      let next: number;
      switch (event.key) {
        case "ArrowDown":
          next = clamp(value + step);
          break;
        case "ArrowUp":
          next = clamp(value - step);
          break;
        case "Home":
          next = clamp(min);
          break;
        case "End":
          next = clamp(max);
          break;
        default:
          return;
      }
      event.preventDefault();
      onResize(next);
      onResizeEnd(next);
    },
    [clamp, height, max, min, onResize, onResizeEnd, value]
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: an interactive window splitter; <hr> can't take focus or pointer input.
    <div
      aria-orientation="horizontal"
      aria-valuemax={Math.round(max * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuenow={Math.round(value * 100)}
      className={cn(
        // Takes no height of its own: 4px either side of the edge it sits on.
        "relative z-20 -my-1 h-2 shrink-0 cursor-row-resize touch-none select-none outline-none",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-1 before:h-px before:bg-border before:transition-colors before:duration-(--motion-fast)",
        "hover:before:bg-foreground/40 focus-visible:before:h-0.5 focus-visible:before:bg-ring data-dragging:before:bg-foreground/60",
        className
      )}
      data-dragging={dragging ? "" : undefined}
      data-slot="workspace-split-handle"
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      role="separator"
      tabIndex={0}
      {...props}
    />
  );
}
