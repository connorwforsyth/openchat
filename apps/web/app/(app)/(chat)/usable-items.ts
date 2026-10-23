import type { AgentSource } from "@workspace/composer/schemas";
import type { LibraryVersionId } from "@workspace/contract/schemas/common";
import type {
  LibraryItem,
  LibraryKind,
} from "@workspace/contract/schemas/library";

// The library items of one kind a person can pick in the composer: their
// own, those shared with them, and those in their teams' and orgs'
// libraries, each once, in that order. Published items are shared with the
// team; an item of their own that was never published is their draft,
// offered to them alone and run at its draft version. Pure.

export interface UsableItem {
  /** Set for the person's own unpublished draft: the version a pick runs. */
  readonly draftVersion?: LibraryVersionId;
  readonly item: LibraryItem;
  readonly source: AgentSource;
}

export interface TabItems {
  readonly items: readonly LibraryItem[];
  readonly source: AgentSource;
}

export const usableItems = (
  lists: readonly TabItems[],
  kind: LibraryKind
): readonly UsableItem[] => {
  const usable: UsableItem[] = [];
  for (const { items, source } of lists) {
    for (const item of items) {
      if (
        item.kind !== kind ||
        usable.some((each) => each.item.id === item.id)
      ) {
        continue;
      }
      if (item.latestVersionId !== null) {
        usable.push({ item, source });
      } else if (source === "mine" && item.draftVersionId !== null) {
        usable.push({ draftVersion: item.draftVersionId, item, source });
      }
    }
  }
  return usable;
};
