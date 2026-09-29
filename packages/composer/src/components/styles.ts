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

/** The ProseMirror element. The placeholder is TipTap's `data-placeholder` on the empty first paragraph. */
export const EDITOR_CLASS = [
  INPUT_BOX,
  "overflow-y-auto break-words outline-none",
  "[&_.is-editor-empty:first-child]:before:pointer-events-none",
  "[&_.is-editor-empty:first-child]:before:float-start",
  "[&_.is-editor-empty:first-child]:before:h-0",
  "[&_.is-editor-empty:first-child]:before:text-muted-foreground",
  "[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
].join(" ");
