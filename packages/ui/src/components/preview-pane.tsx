"use client";

import { cn } from "cn";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// A side card that shows the active item of a list beside it (099): the
// model picker's details card. Base UI's PreviewCard opens on hover over a
// link, so the keyboard never drives it; this follows whatever value the
// list says is active instead, so arrow keys and the pointer both move it.
// It's list-agnostic: cmdk's `Command` takes `value` / `onValueChange`, so
// spreading `usePreviewPane().bind` onto one wires it; a listbox or menu
// that reports its highlighted item works the same way.

interface PreviewPaneState {
  /** Props for the list's root: its active value and the setter it calls. */
  readonly bind: {
    readonly onValueChange: (value: string) => void;
    readonly value: string;
  };
  /** The active item's value; `""` when nothing is active. */
  readonly value: string;
}

const PreviewPaneContext = createContext<PreviewPaneState | null>(null);

/** The pane's active value and the props that bind a list to it. */
export const usePreviewPane = (): PreviewPaneState => {
  const state = useContext(PreviewPaneContext);
  if (state === null) {
    throw new Error("usePreviewPane must be used inside <PreviewPane>");
  }
  return state;
};

export type PreviewPaneProps = Omit<
  ComponentProps<"div">,
  "defaultValue" | "onChange"
> & {
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  /** The active item, when the caller controls it (it can also bind the list). */
  readonly value?: string;
};

/**
 * Lays out a list and its preview card side by side, the card top-aligned
 * to the list; under the `sm` breakpoint (640px) the card sits below the
 * list instead. Controlled with `value` / `onValueChange`, or not.
 */
export function PreviewPane({
  children,
  className,
  defaultValue = "",
  onValueChange,
  value: controlled,
  ...props
}: PreviewPaneProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const value = controlled ?? uncontrolled;
  const setValue = useCallback(
    (next: string) => {
      if (controlled === undefined) {
        setUncontrolled(next);
      }
      onValueChange?.(next);
    },
    [controlled, onValueChange]
  );
  const state = useMemo(
    () => ({ bind: { onValueChange: setValue, value }, value }),
    [setValue, value]
  );
  return (
    <PreviewPaneContext.Provider value={state}>
      <div
        className={cn(
          "flex flex-col items-stretch gap-2 sm:flex-row sm:items-start",
          className
        )}
        data-slot="preview-pane"
        {...props}
      >
        {children}
      </div>
    </PreviewPaneContext.Provider>
  );
}

export type PreviewPaneListProps = ComponentProps<"div">;

/** The list's side of the pane: takes the room the card leaves. */
export function PreviewPaneList({ className, ...props }: PreviewPaneListProps) {
  return (
    <div
      className={cn("min-w-0 flex-1", className)}
      data-slot="preview-pane-list"
      {...props}
    />
  );
}

export type PreviewPaneContentProps = Omit<
  ComponentProps<"div">,
  "children"
> & {
  /**
   * What to show for the active value. Return `null` to show no card (no
   * active item, or nothing to say about it).
   */
  readonly children: (value: string) => ReactNode;
};

/**
 * The card. It isn't a live region: the list already announces the active
 * item, and reading the card on every arrow press would drown it out.
 */
export function PreviewPaneContent({
  children,
  className,
  ...props
}: PreviewPaneContentProps) {
  const { value } = usePreviewPane();
  const content = value === "" ? null : children(value);
  if (content === null || content === undefined || content === false) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex w-full shrink-0 flex-col gap-3 rounded-xl bg-popover p-3 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10 sm:w-56",
        className
      )}
      data-slot="preview-pane-content"
      data-value={value}
      {...props}
    >
      {content}
    </div>
  );
}
