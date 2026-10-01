import type { ComposerAppearance } from "../props";

// Class lists the shell and the editor share, so swapping one for the other
// doesn't move a pixel.

// The frame follows shadcn's chatbot template: a soft `bg-input/50` field
// with rounded-2xl corners and a quiet `ring-ring/30` focus ring. The shell's
// textarea is InputGroup's own control (its ring is InputGroup's, softened
// here); the editor's contenteditable isn't, so it gets the same ring by hand.
const FOCUS_RING = [
  "has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30",
  "has-[[contenteditable=true]:focus]:border-ring",
  "has-[[contenteditable=true]:focus]:ring-3",
  "has-[[contenteditable=true]:focus]:ring-ring/30",
].join(" ");

/** The frame around input, attachments and footer. */
export const FRAME_CLASS = `overflow-visible rounded-2xl bg-input/50 dark:bg-input/50 ${FOCUS_RING}`;

// Mirrors InputGroupTextarea (text-base md:text-sm) with the composer's own
// padding and its min and max heights.
const INPUT_BOX =
  "min-h-16 max-h-48 w-full flex-1 px-3.5 pt-3 pb-2 text-base md:text-sm";

/** Added to the shell's InputGroupTextarea. */
export const SHELL_INPUT_CLASS =
  "field-sizing-content max-h-48 min-h-16 px-3.5 pt-3 pb-2";

// The strip (135): one bare row, no frame, field or focus ring, so the host's
// surface (Quick AI's translucent window) is the background. Larger text, one
// 28px line plus padding tall, growing to about five lines and then
// scrolling with the scrollbar hidden.
/**
 * The frame in a strip: a row, the input then Send, both at the end. As tall
 * as the input (InputGroup is one control high), and it stays clear and
 * opaque while Send is disabled (InputGroup greys a group with a disabled
 * control in it).
 */
export const STRIP_FRAME_CLASS = [
  "h-auto items-end gap-0 rounded-none border-0 bg-transparent shadow-none dark:bg-transparent",
  "has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-transparent",
  "has-[[data-slot=input-group-control]:focus-visible]:border-transparent",
  "has-[[data-slot=input-group-control]:focus-visible]:ring-0",
].join(" ");

const STRIP_INPUT_BOX =
  "no-scrollbar min-h-15 max-h-44 w-full flex-1 px-1 py-4 text-lg leading-7 md:text-lg";

/** Added to the shell's InputGroupTextarea in a strip. */
export const SHELL_STRIP_INPUT_CLASS = `field-sizing-content ${STRIP_INPUT_BOX}`;

/** Holds Send at the end of a strip, centred on the first line. */
export const STRIP_SEND_CLASS = "flex shrink-0 pe-3 pb-4";

const EDITOR_BEHAVIOUR = [
  "overflow-y-auto break-words outline-none",
  "[&_.is-editor-empty:first-child]:before:pointer-events-none",
  "[&_.is-editor-empty:first-child]:before:float-start",
  "[&_.is-editor-empty:first-child]:before:h-0",
  "[&_.is-editor-empty:first-child]:before:text-muted-foreground",
  "[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
].join(" ");

/** The ProseMirror element. The placeholder is TipTap's `data-placeholder` on the empty first paragraph. */
export const EDITOR_CLASS = `${INPUT_BOX} ${EDITOR_BEHAVIOUR}`;

/** The ProseMirror element in a strip. */
export const STRIP_EDITOR_CLASS = `${STRIP_INPUT_BOX} ${EDITOR_BEHAVIOUR}`;

/** The class lists for each appearance: the frame, the editor and the shell's textarea. */
export const LOOKS: Record<
  ComposerAppearance,
  {
    readonly editor: string;
    readonly frame: string;
    readonly shellInput: string;
  }
> = {
  default: {
    editor: EDITOR_CLASS,
    frame: FRAME_CLASS,
    shellInput: SHELL_INPUT_CLASS,
  },
  strip: {
    editor: STRIP_EDITOR_CLASS,
    frame: STRIP_FRAME_CLASS,
    shellInput: SHELL_STRIP_INPUT_CLASS,
  },
};
