import type { ConversationId } from "@workspace/contract/schemas/common";

// Bulk selection in the sidebar (178): ⌘/Ctrl-click toggles a row,
// ⇧-click selects the range from the last row picked, Escape clears. A pure
// reducer over the rows' visible order, so it's tested without a browser.

export interface Selection {
  /** Where a ⇧-click range starts: the last row toggled. */
  readonly anchor: ConversationId | null;
  readonly ids: ReadonlySet<ConversationId>;
}

export type SelectionAction =
  | { readonly id: ConversationId; readonly type: "toggle" }
  | {
      readonly id: ConversationId;
      readonly order: readonly ConversationId[];
      readonly type: "range";
    }
  | { readonly type: "clear" }
  | { readonly keep: ReadonlySet<ConversationId>; readonly type: "prune" };

export const emptySelection: Selection = { anchor: null, ids: new Set() };

export const selectionReducer = (
  state: Selection,
  action: SelectionAction
): Selection => {
  switch (action.type) {
    case "toggle": {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
      } else {
        ids.add(action.id);
      }
      return { anchor: action.id, ids };
    }
    case "range": {
      const from = state.anchor ? action.order.indexOf(state.anchor) : -1;
      const to = action.order.indexOf(action.id);
      if (from === -1 || to === -1) {
        return selectionReducer(state, { id: action.id, type: "toggle" });
      }
      const [start, end] = from < to ? [from, to] : [to, from];
      return {
        anchor: state.anchor,
        ids: new Set([...state.ids, ...action.order.slice(start, end + 1)]),
      };
    }
    case "clear":
      return emptySelection;
    case "prune": {
      // Rows that left the list (archived elsewhere) leave the selection.
      const ids = new Set([...state.ids].filter((id) => action.keep.has(id)));
      return ids.size === state.ids.size ? state : { ...state, ids };
    }
    default:
      return action satisfies never;
  }
};
