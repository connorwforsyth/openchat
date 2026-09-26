// Class lists the shell and the editor share, so swapping one for the other
// doesn't move a pixel.

/** The frame around input, attachments and footer. */
export const FRAME_CLASS = "overflow-visible bg-background";

// Mirrors InputGroupTextarea (px-2.5 py-2 text-base md:text-sm) plus the
// composer's min and max heights.
const INPUT_BOX =
  "min-h-16 max-h-48 w-full flex-1 px-2.5 py-2 text-base md:text-sm";

/** Added to the shell's InputGroupTextarea. */
export const SHELL_INPUT_CLASS = "field-sizing-content max-h-48 min-h-16";

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
