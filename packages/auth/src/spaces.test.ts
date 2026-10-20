import type { OrgId, TeamId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import {
  allowanceFor,
  contentSpacesFor,
  effectiveSpaceAccess,
  type SpaceFacts,
} from "./spaces";

const org = "0190a000-0000-7000-8000-000000000001" as OrgId;
const personal = "0190a000-0000-7000-8000-000000000002" as OrgId;
const design = "0190a000-0000-7000-8000-000000000011" as TeamId;
const brand = "0190a000-0000-7000-8000-000000000012" as TeamId;
const eng = "0190a000-0000-7000-8000-000000000013" as TeamId;

const facts = (overrides: Partial<SpaceFacts["orgs"][number]> = {}) =>
  ({
    orgs: [
      {
        id: personal,
        isPersonal: true,
        memberCount: 1,
        name: "Personal",
        role: "owner",
        teamRoles: new Map(),
        teams: [],
      },
      {
        id: org,
        isPersonal: false,
        memberCount: 4,
        name: "Acme",
        role: "member",
        teamRoles: new Map([[brand, "member" as const]]),
        teams: [
          { id: design, memberCount: 2, name: "Design", parentId: null },
          { id: brand, memberCount: 2, name: "Brand", parentId: design },
          { id: eng, memberCount: 1, name: "Engineering", parentId: null },
        ],
        ...overrides,
      },
    ],
  }) satisfies SpaceFacts;

const byId = (spaces: ReturnType<typeof effectiveSpaceAccess>) =>
  new Map(spaces.map((space) => [space.id, space]));

describe("effectiveSpaceAccess", () => {
  it("lists the personal space first, then each org and its sub-spaces", () => {
    const spaces = effectiveSpaceAccess(facts());
    expect(spaces.map((space) => space.name)).toEqual([
      "Personal",
      "Acme",
      "Design",
      "Brand",
      "Engineering",
    ]);
    expect(byId(spaces).get(brand)?.parent).toEqual({
      id: design,
      type: "team",
    });
    expect(byId(spaces).get(design)?.parent).toEqual({ id: org, type: "org" });
  });

  it("marks direct membership, and sub-spaces a member only sees from the root", () => {
    const spaces = byId(effectiveSpaceAccess(facts()));
    expect(spaces.get(brand)).toMatchObject({
      access: "member",
      canManage: false,
      myRole: "member",
    });
    expect(spaces.get(eng)).toMatchObject({
      access: "root_member",
      myRole: null,
    });
  });

  it("gives a sub-space owner its whole subtree to manage, nothing above or beside", () => {
    const spaces = byId(
      effectiveSpaceAccess(facts({ teamRoles: new Map([[design, "admin"]]) }))
    );
    expect(spaces.get(design)).toMatchObject({
      canManage: true,
      myRole: "owner",
    });
    expect(spaces.get(brand)).toMatchObject({
      access: "admin",
      canManage: true,
    });
    expect(spaces.get(eng)?.canManage).toBe(false);
    expect(spaces.get(org)?.canManage).toBe(false);
  });

  it("lets org owners and admins manage every space in the org", () => {
    const spaces = effectiveSpaceAccess(facts({ role: "admin" }));
    expect(
      spaces.filter((space) => space.orgId === org).every((s) => s.canManage)
    ).toBe(true);
    expect(byId(spaces).get(eng)?.access).toBe("admin");
  });
});

describe("contentSpacesFor", () => {
  const tree = facts().orgs[1]?.teams ?? [];

  it("shows a space's own content and everything flowing down from above", () => {
    expect(contentSpacesFor({ id: brand, type: "team" }, org, tree)).toEqual([
      { id: brand, type: "team" },
      { id: design, type: "team" },
      { id: org, type: "org" },
    ]);
  });

  it("never pulls content up from a sub-space or across from a sibling", () => {
    const visible = contentSpacesFor({ id: design, type: "team" }, org, tree);
    expect(visible).not.toContainEqual({ id: brand, type: "team" });
    expect(visible).not.toContainEqual({ id: eng, type: "team" });
    expect(contentSpacesFor({ id: org, type: "org" }, org, tree)).toEqual([
      { id: org, type: "org" },
    ]);
  });
});

describe("allowanceFor", () => {
  it("is nothing without an approved grant", () => {
    expect(
      allowanceFor({ grant: null, poolTokens: 1000, poolUsed: 0, userUsed: 0 })
    ).toBe(0);
    expect(
      allowanceFor({
        grant: { monthlyTokens: 500, status: "pending" },
        poolTokens: 1000,
        poolUsed: 0,
        userUsed: 0,
      })
    ).toBe(0);
  });

  it("is what's left of the grant, capped by what's left of the pool", () => {
    const grant = { monthlyTokens: 500, status: "approved" } as const;
    expect(
      allowanceFor({ grant, poolTokens: 1000, poolUsed: 100, userUsed: 200 })
    ).toBe(300);
    expect(
      allowanceFor({ grant, poolTokens: 1000, poolUsed: 900, userUsed: 0 })
    ).toBe(100);
    expect(
      allowanceFor({ grant, poolTokens: 1000, poolUsed: 0, userUsed: 900 })
    ).toBe(0);
    expect(
      allowanceFor({ grant, poolTokens: null, poolUsed: 0, userUsed: 0 })
    ).toBe(0);
  });
});
