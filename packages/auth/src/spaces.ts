import type { OrgId, TeamId } from "@workspace/contract/schemas/common";
import type {
  Space,
  SpaceRef,
  SpaceRole,
} from "@workspace/contract/schemas/spaces";
import type { OrgRole, TeamRole } from "@workspace/contract/schemas/tenancy";

import { ancestorsOf, type TeamNode } from "./access";

// Spaces (ticket 187), as pure functions over facts loaded at the shell. A
// root space is an org and a sub-space is a team (188). Access to manage
// flows down the tree; shared content flows down too, never up or sideways
// (189). A sub-space's owner is stored as team `admin` (190).

export interface SpaceTeamFact extends TeamNode {
  readonly memberCount: number;
  readonly name: string;
}

export interface SpaceOrgFact {
  readonly id: OrgId;
  readonly isPersonal: boolean;
  readonly memberCount: number;
  readonly name: string;
  /** The caller's org role. */
  readonly role: OrgRole;
  /** The caller's direct team memberships in this org. */
  readonly teamRoles: ReadonlyMap<TeamId, TeamRole>;
  /** The org's team tree, oldest first. */
  readonly teams: readonly SpaceTeamFact[];
}

export interface SpaceFacts {
  readonly orgs: readonly SpaceOrgFact[];
}

const isOrgAdmin = (role: OrgRole): boolean =>
  role === "owner" || role === "admin";

/** A stored team role as a space role: team `admin` is the sub-space owner. */
export const teamRoleToSpaceRole = (role: TeamRole): SpaceRole =>
  role === "admin" ? "owner" : "member";

/** A space role as a stored team role; a sub-space has no separate admin. */
export const spaceRoleToTeamRole = (role: SpaceRole): TeamRole =>
  role === "member" ? "member" : "admin";

/** Teams in depth-first order, so a flat list reads as an outline. */
const outline = (teams: readonly SpaceTeamFact[]): SpaceTeamFact[] => {
  const ids = new Set(teams.map((each) => each.id));
  const childrenOf = (parentId: TeamId | null) =>
    teams.filter((each) =>
      parentId === null
        ? each.parentId === null || !ids.has(each.parentId)
        : each.parentId === parentId
    );
  const seen = new Set<TeamId>();
  const walk = (parentId: TeamId | null): SpaceTeamFact[] =>
    childrenOf(parentId).flatMap((each) => {
      if (seen.has(each.id)) {
        return [];
      }
      seen.add(each.id);
      return [each, ...walk(each.id)];
    });
  return walk(null);
};

const orgSpace = (fact: SpaceOrgFact): Space => ({
  access: "member",
  canManage: isOrgAdmin(fact.role),
  id: fact.id,
  isPersonal: fact.isPersonal,
  memberCount: fact.memberCount,
  myRole: fact.role,
  name: fact.name,
  orgId: fact.id,
  parent: null,
  type: "org",
});

const teamSpace = (fact: SpaceOrgFact, node: SpaceTeamFact): Space => {
  const direct = fact.teamRoles.get(node.id);
  const ownsAbove = ancestorsOf(node.id, fact.teams).some(
    (id) => fact.teamRoles.get(id) === "admin"
  );
  const manages = isOrgAdmin(fact.role) || ownsAbove;
  const reach = (): Space["access"] => {
    if (direct) {
      return "member";
    }
    return manages ? "admin" : "root_member";
  };
  return {
    access: reach(),
    canManage: manages,
    id: node.id,
    isPersonal: false,
    memberCount: node.memberCount,
    myRole: direct ? teamRoleToSpaceRole(direct) : null,
    name: node.name,
    orgId: fact.id,
    parent: node.parentId
      ? { id: node.parentId, type: "team" }
      : { id: fact.id, type: "org" },
    type: "team",
  };
};

/**
 * Every space the caller can see: the personal space first, then each org
 * with its sub-spaces in outline order. Members of an org see its whole tree
 * (they can ask to join), but only content of spaces they reach (see
 * `canSeeContent`).
 */
export const effectiveSpaceAccess = (facts: SpaceFacts): Space[] =>
  [...facts.orgs]
    .sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal))
    .flatMap((fact) => [
      orgSpace(fact),
      ...outline(fact.teams).map((node) => teamSpace(fact, node)),
    ]);

/**
 * The spaces whose shared content shows in `space`: itself, then each space
 * above it up to the root. Content flows down only (189).
 */
export const contentSpacesFor = (
  space: SpaceRef,
  orgId: OrgId,
  tree: readonly TeamNode[]
): SpaceRef[] => [
  ...(space.type === "team"
    ? ancestorsOf(space.id, tree).map((id): SpaceRef => ({ id, type: "team" }))
    : []),
  { id: orgId, type: "org" },
];

/**
 * Whether the caller sees what's shared in a space: they're in it, manage
 * it, or are in a space below it (content flows down to them).
 */
export const canSeeContent = (
  space: Space,
  all: readonly Space[],
  tree: readonly TeamNode[]
): boolean =>
  space.access !== "root_member" ||
  all.some(
    (other) =>
      other.type === "team" &&
      other.access === "member" &&
      space.type === "team" &&
      ancestorsOf(other.id as TeamId, tree).includes(space.id as TeamId)
  );

export interface AllowanceFacts {
  /** The caller's grant in this space, if any. */
  readonly grant: {
    readonly monthlyTokens: number;
    readonly status: "pending" | "approved" | "denied";
  } | null;
  /** The space's monthly pool; `null` when it has none. */
  readonly poolTokens: number | null;
  /** Tokens everyone used in the space this month. */
  readonly poolUsed: number;
  /** Tokens the caller used in the space this month. */
  readonly userUsed: number;
}

/**
 * Tokens the caller may still use this month in a space (192): what's left
 * of an approved grant, capped by what's left of the pool.
 */
export const allowanceFor = (facts: AllowanceFacts): number => {
  if (facts.grant?.status !== "approved" || facts.poolTokens === null) {
    return 0;
  }
  const grantLeft = facts.grant.monthlyTokens - facts.userUsed;
  const poolLeft = facts.poolTokens - facts.poolUsed;
  return Math.max(0, Math.min(grantLeft, poolLeft));
};
