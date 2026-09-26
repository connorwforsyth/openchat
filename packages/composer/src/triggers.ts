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
