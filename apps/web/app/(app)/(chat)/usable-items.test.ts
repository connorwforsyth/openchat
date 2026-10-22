import { agentItem, fixtureId } from "@workspace/contract/fixtures";
import type { LibraryItem } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import { usableItems } from "./usable-items";

const item = (n: number, patch: Partial<LibraryItem> = {}): LibraryItem => ({
  ...agentItem,
  id: fixtureId("libraryItem", n),
  kind: "prompt",
  name: `Prompt ${n}`,
  ...patch,
});

describe("usableItems", () => {
  it("offers published items from every tab and unpublished ones only as the person's own drafts", () => {
    const unpublished = {
      draftVersionId: fixtureId("libraryVersion", 8),
      latestVersionId: null,
    };
    const usable = usableItems(
      [
        {
          items: [
            item(1, unpublished),
            // Someone else's draft they can't edit shows no draft to them.
            item(2, { draftVersionId: null, latestVersionId: null }),
          ],
          source: "mine",
        },
        { items: [item(3, unpublished), item(4)], source: "shared" },
        { items: [item(5, { kind: "agent" })], source: "libraries" },
      ],
      "prompt"
    );
    expect(
      usable.map(({ draftVersion, item: each }) => [each.name, draftVersion])
    ).toEqual([
      ["Prompt 1", fixtureId("libraryVersion", 8)],
      ["Prompt 4", undefined],
    ]);
  });
});
