import {
  agentItem,
  fixtureId,
  grant,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import type { ResourceGrant } from "@workspace/contract/schemas/grants";
import type { LibraryItem } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import {
  applyItemUpdate,
  definitionView,
  type ListData,
  patchListItem,
  pendingCopy,
  prependListItem,
  removeListItem,
  setGrantLevel,
  upsertGrant,
  withoutGrant,
} from "./cache";

const {
  definition: _definition,
  versionId: _versionId,
  ...listItem
} = agentItem;
const item: LibraryItem = listItem;
const other: LibraryItem = {
  ...item,
  id: fixtureId("libraryItem", 77),
  name: "Other",
};

const pages = (...lists: LibraryItem[][]): ListData => ({
  pageParams: lists.map(() => undefined),
  pages: lists.map((items) => ({ items, nextCursor: null })),
});

describe("list cache edits", () => {
  it("patches, removes and prepends without touching other items", () => {
    const data = pages([item], [other]);
    expect(
      patchListItem(data, item.id, { name: "Renamed" })?.pages[0]?.items[0]
        ?.name
    ).toBe("Renamed");
    expect(
      patchListItem(data, item.id, { name: "x" })?.pages[1]?.items[0]
    ).toBe(other);
    expect(
      removeListItem(data, other.id)?.pages.map((page) => page.items.length)
    ).toEqual([1, 0]);
    expect(
      prependListItem(pages([item]), other)?.pages[0]?.items.map((i) => i.id)
    ).toEqual([other.id, item.id]);
    expect(patchListItem(undefined, item.id, {})).toBeUndefined();
  });

  it("makes a placeholder library copy owned by the target", () => {
    const copy = pendingCopy(
      item,
      { id: fixtureId("team", 2), type: "team" },
      userAda.id
    );
    expect(copy).toMatchObject({
      myAccess: "maintainer",
      owner: { type: "team" },
      publishedFrom: item.id,
      visibility: "published",
    });
    expect(copy.id).not.toBe(item.id);
  });
});

describe("definitions as they read back", () => {
  it("shows a typed MCP secret as configured and never keeps the value", () => {
    const view = definitionView(
      {
        auth: { headerName: "Authorization", type: "header", value: "s3cret" },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test",
      },
      null
    );
    expect(view).toEqual({
      auth: { configured: true, headerName: "Authorization", type: "header" },
      kind: "mcp_server",
      transport: "http",
      url: "https://mcp.example.test",
    });
    expect(JSON.stringify(view)).not.toContain("s3cret");
  });

  it("keeps a stored secret only while the URL and header stay the same", () => {
    const before = {
      auth: {
        configured: true,
        headerName: "Authorization",
        type: "header" as const,
      },
      kind: "mcp_server" as const,
      transport: "http" as const,
      url: "https://a.example.test",
    };
    const same = definitionView(
      { ...before, auth: { headerName: "Authorization", type: "header" } },
      before
    );
    const moved = definitionView(
      {
        ...before,
        auth: { headerName: "Authorization", type: "header" },
        url: "https://b.example.test",
      },
      before
    );
    expect(same).toMatchObject({ auth: { configured: true } });
    expect(moved).toMatchObject({ auth: { configured: false } });
  });

  it("applies an edit to a detail", () => {
    const next = applyItemUpdate(agentItem, { description: "New", name: "N" });
    expect(next).toMatchObject({ description: "New", name: "N" });
    expect(applyItemUpdate(undefined, { name: "N" })).toBeUndefined();
  });
});

describe("grant cache edits", () => {
  it("replaces a principal's level rather than adding a second row", () => {
    const again = {
      ...grant,
      id: fixtureId("grant", 9),
      permission: "edit",
    } as ResourceGrant;
    const next = upsertGrant([grant], again);
    expect(next).toHaveLength(1);
    expect(next[0]?.permission).toBe("edit");
    const bo = {
      ...grant,
      id: fixtureId("grant", 10),
      principal: { id: userAda.id, type: "user" as const },
    };
    expect(upsertGrant([grant], bo)).toHaveLength(2);
    expect(setGrantLevel([grant], grant.id, "view")[0]?.permission).toBe(
      "view"
    );
    expect(withoutGrant([grant], grant.id)).toEqual([]);
    expect(grant.principal.id).toBe(userBo.id);
  });
});
