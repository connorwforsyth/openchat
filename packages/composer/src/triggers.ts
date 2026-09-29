// Keys for the `/` and `@` menus. TipTap's Suggestion utility finds the
// trigger and query; what the keys do while a menu is open is decided here.

export type MenuKeyAction = "choose" | "dismiss" | "next" | "previous";

/**
 * What a key does while a suggestion menu is open. Enter and Tab pick (Shift
 * keeps them for a newline and focus traversal); anything else types.
 */
export const menuKeyAction = (key: {
  readonly key: string;
  readonly shiftKey: boolean;
}): MenuKeyAction | undefined => {
  switch (key.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Enter":
    case "Tab":
      return key.shiftKey ? undefined : "choose";
    case "Escape":
      return "dismiss";
    default:
      return;
  }
};

/** The next active index, wrapping at both ends. */
export const moveActive = (
  index: number,
  count: number,
  direction: "next" | "previous"
): number => {
  if (count <= 0) {
    return 0;
  }
  const step = direction === "next" ? 1 : -1;
  return (index + step + count) % count;
};

/**
 * What `/` is listing. Choosing `/open` rewrites the trigger to `/open:`, so
 * the same Suggestion keeps running and whatever follows filters the files;
 * Backspace past the colon is back at the commands. (The query can't hold a
 * `/` or a space, TipTap's rule for a single-word trigger, so a file is found
 * by its name or part of its path.)
 */
export type SlashStage =
  | { readonly query: string; readonly stage: "commands" }
  | { readonly query: string; readonly stage: "open" };

/** What `/open` leaves in the text: the trigger for the file list. */
export const OPEN_TRIGGER = "open:";

export const slashStage = (query: string): SlashStage =>
  query.startsWith(OPEN_TRIGGER)
    ? { query: query.slice(OPEN_TRIGGER.length), stage: "open" }
    : { query, stage: "commands" };
