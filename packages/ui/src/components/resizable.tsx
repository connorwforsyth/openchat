"use client";

import { cn } from "cn";
import {
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Group,
  type GroupProps,
  Panel,
  type PanelProps,
  Separator,
  type SeparatorProps,
} from "react-resizable-panels";

function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      data-slot="resizable-panel-group"
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      data-slot="resizable-handle"
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      ) : null}
    </Separator>
  );
}

// A column's edge you drag, in pixels (ticket 071). Hand-written rather than
// `ResizablePanelGroup` because the shell's columns are pixel-sized with
// limits that depend on each other, and a WAI-ARIA window splitter needs
// little more than this: an 8px hit strip that shows a 1px line on hover or
// drag, pointer capture, no text selection while dragging, double-click to
// reset, ←/→ to nudge and Home/End for the limits.

interface Drag {
  last: number;
  readonly pointerId: number;
  /** +1 when moving toward the inline end makes the column wider. */
  readonly sign: 1 | -1;
  readonly startValue: number;
  readonly startX: number;
}

type ResizeHandleProps = Omit<
  ComponentProps<"div">,
  "children" | "onResize" | "role"
> & {
  /** Double-click resets to this. */
  readonly defaultValue: number;
  readonly max: number;
  readonly min: number;
  /** Every change while dragging or nudging, for the live layout. */
  readonly onResize: (width: number) => void;
  /** A finished change (release, key press, reset): the one to keep. */
  readonly onResizeEnd: (width: number) => void;
  /** Whether the column this resizes sits before (start side) or after it. */
  readonly resizes: "after" | "before";
  /** How far one arrow key press moves it. */
  readonly step?: number;
  /** The column's current width. */
  readonly value: number;
};

const isRtl = (element: Element): boolean =>
  getComputedStyle(element).direction === "rtl";

function ResizeHandle({
  className,
  defaultValue,
  max,
  min,
  onResize,
  onResizeEnd,
  resizes,
  step = 16,
  value,
  ...props
}: ResizeHandleProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = useCallback(
    (width: number) => Math.min(max, Math.max(min, Math.round(width))),
    [max, min]
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
      if (event.button !== 0) {
        return;
      }
      // No text selection starts, and focus stays where it was.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const growsTowardEnd = resizes === "before";
      const rtl = isRtl(event.currentTarget);
      drag.current = {
        last: value,
        pointerId: event.pointerId,
        sign: growsTowardEnd === rtl ? -1 : 1,
        startValue: value,
        startX: event.clientX,
      };
      setDragging(true);
    },
    [resizes, value]
  );
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const { current } = drag;
      if (current?.pointerId !== event.pointerId) {
        return;
      }
      const next = clamp(
        current.startValue + (event.clientX - current.startX) * current.sign
      );
      if (next !== current.last) {
        current.last = next;
        onResize(next);
      }
    },
    [clamp, onResize]
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
      const towardEnd = isRtl(event.currentTarget) ? "ArrowLeft" : "ArrowRight";
      const towardStart =
        towardEnd === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
      const grow = resizes === "before" ? towardEnd : towardStart;
      const shrink = resizes === "before" ? towardStart : towardEnd;
      let next: number;
      switch (event.key) {
        case grow:
          next = clamp(value + step);
          break;
        case shrink:
          next = clamp(value - step);
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = max;
          break;
        default:
          return;
      }
      event.preventDefault();
      onResize(next);
      onResizeEnd(next);
    },
    [clamp, max, min, onResize, onResizeEnd, resizes, step, value]
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: an interactive window splitter; <hr> can't take focus or pointer input.
    <div
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={cn(
        // Takes no width of its own: 4px either side of the edge it sits on.
        "relative z-20 -mx-1 w-2 shrink-0 cursor-col-resize touch-none select-none outline-none",
        "before:pointer-events-none before:absolute before:inset-y-0 before:start-1 before:w-px before:bg-border before:transition-colors before:duration-(--motion-fast)",
        "hover:before:bg-foreground/40 focus-visible:before:w-0.5 focus-visible:before:bg-ring data-dragging:before:bg-foreground/60",
        className
      )}
      data-dragging={dragging ? "" : undefined}
      data-slot="resize-handle"
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

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, ResizeHandle };
