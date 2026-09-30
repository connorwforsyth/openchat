import { isEditableTarget, keyTarget } from "../../shortcuts/editable";

// Focus rules for the Workspace panel's frame (070), after Connor's
// Zettelkasten: opening the panel moves focus into it, Escape closes one layer
// at a time, and closing hands focus back to what opened it. Pure over the
// DOM, so they're tested without rendering the panel.

/** The focused element, looking inside shadow roots (the editor is in one). */
export const deepActiveElement = (root: Document): Element | null => {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
};

/** `container.contains(node)`, but a node in a shadow root counts as inside its host. */
export const containsComposed = (
  container: Node,
  node: Node | null
): boolean => {
  let current = node;
  while (current) {
    if (container.contains(current)) {
      return true;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
};

/**
 * Whether opening the panel may take focus. Not while someone is typing
 * elsewhere (the composer, when the agent's page opens the Preview by
 * itself), and not from inside a menu or dialog, which owns focus.
 */
export const takesFocusOnOpen = (active: Element | null): boolean =>
  !isEditableTarget(active);

export type EscapeAction = "close" | "ignore" | "leave-field";

/**
 * What Escape does in the panel, one layer at a time: nothing when something
 * inside already handled it (the file search, the address bar) or the key
 * came from outside (a menu or dialog is portalled out of the panel); leave
 * the field when it came from one (the editor would otherwise hold focus);
 * else close the panel.
 */
export const escapeAction = (
  event: Pick<
    KeyboardEvent,
    "composedPath" | "defaultPrevented" | "isComposing" | "key" | "target"
  >,
  frame: Node
): EscapeAction => {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
    return "ignore";
  }
  const target = keyTarget(event);
  if (!(target instanceof Node && containsComposed(frame, target))) {
    return "ignore";
  }
  return isEditableTarget(target) ? "leave-field" : "close";
};

const focusable = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement &&
  element.isConnected &&
  !element.matches(":disabled") &&
  element !== element.ownerDocument.body;

/**
 * Where focus goes once the panel has closed, or `null` to leave it. Only
 * when focus was lost with the panel (it's on `<body>`, or still inside the
 * removed frame): the element that had focus when the panel opened, else the
 * panel's toggle (opened with S, from nowhere in particular).
 */
export const focusReturnTarget = ({
  active,
  fallback,
  frame,
  opener,
}: {
  readonly active: Element | null;
  readonly fallback: Element | null;
  readonly frame: Node;
  readonly opener: Element | null;
}): HTMLElement | null => {
  const lost =
    active === null ||
    active === active.ownerDocument.body ||
    containsComposed(frame, active);
  if (!lost) {
    return null;
  }
  if (focusable(opener) && !containsComposed(frame, opener)) {
    return opener;
  }
  return focusable(fallback) ? fallback : null;
};
