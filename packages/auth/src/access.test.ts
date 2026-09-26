import type { TeamId, UserId } from "@workspace/contract/schemas/common";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { newId } from "@workspace/shared/ids";
import { describe, expect, it } from "vitest";

import {
  type AccessAction,
  type AccessQuery,
  canAccess,
  canManageTeam,
  effectiveGrants,
  expandPrincipals,
  type GrantFact,
  orgAdminVisibility,
  type ResourceFacts,
  strongestOrgRole,
  type TeamNode,
  wouldCreateCycle,
} from "./access";

// One org: Eng › Platform › Infra, and Sales beside Eng.
const org = newId("org");
const otherOrg = newId("org");
const eng = newId("team");
const platform = newId("team");
const infra = newId("team");
const sales = newId("team");
const tree: TeamNode[] = [
  { id: eng, parentId: null },
  { id: platform, parentId: eng },
  { id: infra, parentId: platform },
  { id: sales, parentId: null },
];

const me = newId("user");
const someoneElse = newId("user");
const agent = newId("libraryItem");
const prompt = newId("libraryItem");
const chat = newId("conversation");

const asUser = (id: UserId): Principal => ({ id, type: "user" });
const asTeam = (id: TeamId): Principal => ({ id, type: "team" });
const asOrg = (id: Principal["id"]): Principal =>
  ({ id, type: "org" }) as Principal;

/** I'm in the org and directly in Platform. */
const mine: Principal[] = [asUser(me), asOrg(org), asTeam(platform)];

const onAgent = (
  principal: Principal,
  permission: GrantFact["permission"]
): GrantFact => ({
  permission,
  principal,
  resourceId: agent,
  resourceType: "agent",
});

const onChat = (
  principal: Principal,
  permission: GrantFact["permission"]
): GrantFact => ({
  permission,
  principal,
  resourceId: chat,
  resourceType: "conversation",
});

describe("effectiveGrants", () => {
  it.each<{
    expected: { permission: string; resourceId: string; via: Principal[] }[];
    grants: GrantFact[];
    name: string;
  }>([
    {
      expected: [{ permission: "use", resourceId: agent, via: [asTeam(eng)] }],
      grants: [onAgent(asTeam(eng), "use")],
      name: "a grant to a team flows down to its sub-teams",
    },
    {
      expected: [],
      grants: [onAgent(asTeam(infra), "view")],
      name: "a grant to a sub-team doesn't flow up",
    },
    {
      expected: [],
      grants: [onAgent(asTeam(sales), "edit")],
      name: "a sibling team's grant doesn't apply",
    },
    {
      expected: [{ permission: "edit", resourceId: agent, via: [asUser(me)] }],
      grants: [onAgent(asTeam(eng), "use"), onAgent(asUser(me), "edit")],
      name: "the highest level wins",
    },
    {
      expected: [
        {
          permission: "view",
          resourceId: agent,
          via: [asOrg(org), asTeam(platform)],
        },
      ],
      grants: [onAgent(asOrg(org), "view"), onAgent(asTeam(platform), "view")],
      name: "equal levels list every principal that gave them",
    },
    {
      expected: [{ permission: "viewer", resourceId: chat, via: [asOrg(org)] }],
      grants: [onChat(asOrg(org), "viewer"), onChat(asOrg(otherOrg), "editor")],
      name: "org grants apply only to that org's members",
    },
    {
      expected: [],
      grants: [onChat(asUser(me), "use"), onAgent(asUser(me), "editor")],
      name: "a level the resource type doesn't take grants nothing",
    },
    {
      expected: [],
      grants: [onAgent(asUser(someoneElse), "edit")],
      name: "someone else's grant is theirs",
    },
    {
      expected: [
        { permission: "use", resourceId: agent, via: [asTeam(eng)] },
        { permission: "editor", resourceId: chat, via: [asUser(me)] },
      ],
      grants: [onChat(asUser(me), "editor"), onAgent(asTeam(eng), "use")],
      name: "one entry per resource",
    },
  ])("$name", ({ expected, grants }) => {
    const result = effectiveGrants(mine, grants, tree);
    expect(
      result.map(({ permission, resourceId, via }) => ({
        permission,
        resourceId,
        via,
      }))
    ).toEqual(expected);
  });

  it("survives a cycle in the tree", () => {
    const a = newId("team");
    const b = newId("team");
    const looped: TeamNode[] = [
      { id: a, parentId: b },
      { id: b, parentId: a },
    ];
    expect(
      effectiveGrants([asTeam(a)], [onAgent(asTeam(b), "use")], looped)
    ).toHaveLength(1);
  });

  it("is unchanged by principals that are already expanded", () => {
    const grants = [onAgent(asTeam(eng), "view")];
    expect(effectiveGrants(expandPrincipals(mine, tree), grants, [])).toEqual(
      effectiveGrants(mine, grants, tree)
    );
  });
});

describe("canAccess", () => {
  const personalAgent = (owner: UserId): ResourceFacts => ({
    maintainers: [],
    owner: asUser(owner),
    resourceId: agent,
    resourceType: "agent",
  });
  const publishedTo = (
    owner: Principal,
    maintainers: UserId[] = []
  ): ResourceFacts => ({
    maintainers,
    owner,
    resourceId: agent,
    resourceType: "agent",
  });
  const chatOf = (owner: UserId): ResourceFacts => ({
    ownerId: owner,
    resourceId: chat,
    resourceType: "conversation",
  });
  const query = (
    resource: ResourceFacts,
    grants: GrantFact[] = [],
    extra: Partial<AccessQuery> = {}
  ): AccessQuery => ({
    grants,
    principals: mine,
    resource,
    tree,
    userId: me,
    ...extra,
  });

  it.each<{
    allowed: AccessAction[];
    denied: AccessAction[];
    name: string;
    query: AccessQuery;
  }>([
    {
      allowed: ["use", "view", "edit", "manage"],
      denied: ["viewer"],
      name: "my own library item",
      query: query(personalAgent(me)),
    },
    {
      allowed: [],
      denied: ["use", "view", "edit", "manage"],
      name: "someone else's item, not shared",
      query: query(personalAgent(someoneElse)),
    },
    {
      allowed: ["use"],
      denied: ["view", "edit", "manage"],
      name: "shared with me at `use`: can't see the instructions",
      query: query(personalAgent(someoneElse), [onAgent(asUser(me), "use")]),
    },
    {
      allowed: ["use", "view", "edit"],
      denied: ["manage"],
      name: "shared with me at `edit`: still can't reshare",
      query: query(personalAgent(someoneElse), [onAgent(asUser(me), "edit")]),
    },
    {
      allowed: ["use"],
      denied: ["view", "edit"],
      name: "published to Eng: Platform members use it",
      query: query(publishedTo(asTeam(eng))),
    },
    {
      allowed: ["use", "view"],
      denied: ["edit"],
      name: "published to Eng with `view` granted to Platform",
      query: query(publishedTo(asTeam(eng)), [
        onAgent(asTeam(platform), "view"),
      ]),
    },
    {
      allowed: [],
      denied: ["use"],
      name: "published to Sales: not my library",
      query: query(publishedTo(asTeam(sales))),
    },
    {
      allowed: ["use", "view", "edit", "manage"],
      denied: [],
      name: "a maintainer of a published item",
      query: query(publishedTo(asTeam(sales), [me])),
    },
    {
      allowed: ["use"],
      denied: ["view"],
      name: "published to my org",
      query: query(publishedTo(asOrg(org))),
    },
    {
      allowed: ["viewer", "editor", "manage"],
      denied: ["use"],
      name: "my own chat: always an editor",
      query: query(chatOf(me)),
    },
    {
      allowed: ["viewer"],
      denied: ["editor", "manage"],
      name: "a chat shared with my team as viewer",
      query: query(chatOf(someoneElse), [onChat(asTeam(eng), "viewer")]),
    },
    {
      allowed: [],
      denied: ["viewer"],
      name: "an org admin without the audit policy sees no content",
      query: query(chatOf(someoneElse), [], { adminVisibility: "metadata" }),
    },
    {
      allowed: ["viewer"],
      denied: ["editor"],
      name: "an org admin under the audit policy reads",
      query: query(chatOf(someoneElse), [], { adminVisibility: "content" }),
    },
  ])("$name", ({ allowed, denied, query: q }) => {
    for (const action of allowed) {
      expect(canAccess(q, action), action).toBe(true);
    }
    for (const action of denied) {
      expect(canAccess(q, action), action).toBe(false);
    }
  });

  it("ignores grants on other resources", () => {
    const other: GrantFact = {
      ...onAgent(asUser(me), "edit"),
      resourceId: prompt,
    };
    expect(canAccess(query(personalAgent(someoneElse), [other]), "use")).toBe(
      false
    );
  });
});

describe("orgAdminVisibility", () => {
  it.each([
    { auditEnabled: false, expected: "none", role: "member" },
    { auditEnabled: true, expected: "none", role: "member" },
    { auditEnabled: false, expected: "none", role: null },
    { auditEnabled: false, expected: "metadata", role: "admin" },
    { auditEnabled: false, expected: "metadata", role: "owner" },
    { auditEnabled: true, expected: "content", role: "admin" },
    { auditEnabled: true, expected: "content", role: "owner" },
  ] as const)("$role with audit $auditEnabled sees $expected", (row) => {
    expect(
      orgAdminVisibility({ auditEnabled: row.auditEnabled, role: row.role })
    ).toBe(row.expected);
  });
});

describe("team administration", () => {
  it.each([
    { expected: true, orgRole: "owner", teamAdminOf: [], teamId: infra },
    { expected: true, orgRole: "admin", teamAdminOf: [], teamId: sales },
    { expected: false, orgRole: "member", teamAdminOf: [], teamId: infra },
    { expected: true, orgRole: "member", teamAdminOf: [eng], teamId: infra },
    {
      expected: true,
      orgRole: "member",
      teamAdminOf: [platform],
      teamId: platform,
    },
    {
      expected: false,
      orgRole: "member",
      teamAdminOf: [platform],
      teamId: eng,
    },
    { expected: false, orgRole: "member", teamAdminOf: [eng], teamId: sales },
    { expected: false, orgRole: null, teamAdminOf: [eng], teamId: eng },
  ] as const)(
    "$orgRole, admin of $teamAdminOf.length teams: $expected",
    ({ expected, orgRole, teamAdminOf, teamId }) => {
      expect(canManageTeam({ orgRole, teamAdminOf, teamId, tree })).toBe(
        expected
      );
    }
  );

  it.each([
    { expected: true, parentId: infra, teamId: eng },
    { expected: true, parentId: eng, teamId: eng },
    { expected: false, parentId: sales, teamId: eng },
    { expected: false, parentId: null, teamId: infra },
    { expected: false, parentId: eng, teamId: infra },
  ])(
    "moving under a descendant is a cycle",
    ({ expected, parentId, teamId }) => {
      expect(wouldCreateCycle(teamId, parentId, tree)).toBe(expected);
    }
  );

  it.each([
    { expected: "owner", stored: "member,owner" },
    { expected: "admin", stored: "admin" },
    { expected: "member", stored: " member " },
    { expected: null, stored: "custom" },
  ])("reads the strongest of $stored", ({ expected, stored }) => {
    expect(strongestOrgRole(stored)).toBe(expected);
  });
});
