import { type TeamId, userIdSchema } from "@workspace/contract/schemas/common";
import {
  type ChatPermission,
  chatPermissionSchema,
  type GrantableResourceType,
  grantableResourceTypeSchema,
} from "@workspace/contract/schemas/grants";
import {
  type LibraryPermission,
  libraryPermissionSchema,
} from "@workspace/contract/schemas/library";
import {
  type OrgRole,
  orgRoleSchema,
  type Principal,
  principalSchema,
  teamSchema,
} from "@workspace/contract/schemas/tenancy";
import { z } from "zod";

// Access (D13, D17, D25), as pure functions. `resource_grant` is the only
// source of access beyond ownership; these decide what a user's grants add
// up to. The shell loads the facts (`loadPrincipals`, grants, the team tree,
// the resource's owner) and asks.

export type GrantPermission = ChatPermission | LibraryPermission;

/** A node of an org's team tree: all flow-down needs. */
export const teamNodeSchema = teamSchema.pick({ id: true, parentId: true });
export type TeamNode = z.infer<typeof teamNodeSchema>;

/** A `resource_grant` row, reduced to what access depends on. */
export const grantFactSchema = z.object({
  permission: z.union([chatPermissionSchema, libraryPermissionSchema]),
  principal: principalSchema,
  resourceId: z.string(),
  resourceType: grantableResourceTypeSchema,
});
export type GrantFact = z.infer<typeof grantFactSchema>;

/** What a set of grants adds up to on one resource: the highest level, and who held it. */
export const effectiveGrantSchema = z.object({
  permission: z.union([chatPermissionSchema, libraryPermissionSchema]),
  resourceId: z.string(),
  resourceType: grantableResourceTypeSchema,
  /** The principals whose grants gave that level (the user, a team, an org). */
  via: z.array(principalSchema),
});
export type EffectiveGrant = z.infer<typeof effectiveGrantSchema>;

const CHAT_LEVELS: readonly GrantPermission[] = chatPermissionSchema.options;
const LIBRARY_LEVELS: readonly GrantPermission[] =
  libraryPermissionSchema.options;

const levelsFor = (
  resourceType: GrantableResourceType
): readonly GrantPermission[] =>
  resourceType === "conversation" ? CHAT_LEVELS : LIBRARY_LEVELS;

/**
 * The level's rank for the resource type (each level includes the ones
 * before it), or -1 for a level the type doesn't take: `use` on a chat
 * grants nothing rather than something by accident.
 */
export const levelRank = (
  resourceType: GrantableResourceType,
  permission: string
): number => levelsFor(resourceType).indexOf(permission as GrantPermission);

const higher = (
  resourceType: GrantableResourceType,
  a: GrantPermission | null,
  b: GrantPermission | null
): GrantPermission | null => {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return levelRank(resourceType, b) > levelRank(resourceType, a) ? b : a;
};

const principalKey = (principal: Principal): string =>
  `${principal.type}:${principal.id}`;

/** A team and its ancestors, nearest first. Stops on a cycle rather than looping. */
export const ancestorsOf = (
  teamId: TeamId,
  tree: readonly TeamNode[]
): TeamId[] => {
  const parentOf = new Map(tree.map((node) => [node.id, node.parentId]));
  const seen: TeamId[] = [];
  let current: TeamId | null | undefined = teamId;
  while (current && !seen.includes(current)) {
    seen.push(current);
    current = parentOf.get(current);
  }
  return seen;
};

/** A team and every team below it. */
export const descendantsOf = (
  teamId: TeamId,
  tree: readonly TeamNode[]
): TeamId[] => {
  const found: TeamId[] = [teamId];
  // An array iterator re-reads the length, so teams pushed below are
  // visited too: a breadth-first walk without a separate queue.
  for (const parent of found) {
    for (const node of tree) {
      if (node.parentId === parent && !found.includes(node.id)) {
        found.push(node.id);
      }
    }
  }
  return found;
};

/**
 * Who a user acts as: their own principals plus every ancestor of each team
 * they're in, because a grant to Engineering covers Engineering › Platform
 * (D17). Already-expanded input (`loadPrincipals`) passes through unchanged.
 */
export const expandPrincipals = (
  principals: readonly Principal[],
  tree: readonly TeamNode[]
): Principal[] => {
  const byKey = new Map<string, Principal>();
  for (const principal of principals) {
    const expanded: Principal[] =
      principal.type === "team"
        ? ancestorsOf(principal.id, tree).map((id) => ({ id, type: "team" }))
        : [principal];
    for (const each of expanded) {
      byKey.set(principalKey(each), each);
    }
  }
  return [...byKey.values()];
};

/**
 * What `grants` give a user who acts as `principals`, one entry per resource
 * at the highest level any of them holds. Grants to a team flow down to its
 * descendant teams through `tree`. Levels a resource type doesn't take are
 * ignored. Sorted by resource for stable output.
 */
export const effectiveGrants = (
  principals: readonly Principal[],
  grants: readonly GrantFact[],
  tree: readonly TeamNode[]
): EffectiveGrant[] => {
  const held = new Set(expandPrincipals(principals, tree).map(principalKey));
  const byResource = new Map<string, EffectiveGrant>();
  for (const grant of grants) {
    if (
      !held.has(principalKey(grant.principal)) ||
      levelRank(grant.resourceType, grant.permission) < 0
    ) {
      continue;
    }
    const key = `${grant.resourceType}:${grant.resourceId}`;
    const current = byResource.get(key);
    const currentRank = current
      ? levelRank(current.resourceType, current.permission)
      : -1;
    const rank = levelRank(grant.resourceType, grant.permission);
    if (!current || rank > currentRank) {
      byResource.set(key, {
        permission: grant.permission,
        resourceId: grant.resourceId,
        resourceType: grant.resourceType,
        via: [grant.principal],
      });
    } else if (rank === currentRank) {
      byResource.set(key, {
        ...current,
        via: [...current.via, grant.principal],
      });
    }
  }
  return [...byResource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, grant]) => grant);
};

// --- Resources and actions ---

const libraryResourceTypeSchema = grantableResourceTypeSchema.exclude([
  "conversation",
]);

/** Who owns a resource, loaded by the shell (`loadResourceFacts`). */
export const resourceFactsSchema = z.discriminatedUnion("resourceType", [
  z.object({
    ownerId: userIdSchema,
    resourceId: z.string(),
    resourceType: z.literal("conversation"),
  }),
  z.object({
    /** Maintainers of an item published to a team or org library. */
    maintainers: z.array(userIdSchema),
    /** A user, or the team or org whose library it was published to. */
    owner: principalSchema,
    resourceId: z.string(),
    resourceType: libraryResourceTypeSchema,
  }),
]);
export type ResourceFacts = z.infer<typeof resourceFactsSchema>;

/**
 * What a caller wants to do. The levels are the permission enums (each
 * includes the ones before); `manage` is sharing, share links and deletion,
 * which stays with the owner and maintainers whatever anyone was granted.
 */
export const accessActionSchema = z.union([
  chatPermissionSchema,
  libraryPermissionSchema,
  z.literal("manage"),
]);
export type AccessAction = z.infer<typeof accessActionSchema>;

/** How much of a chat an org admin sees (D17). */
export const adminVisibilitySchema = z.enum(["none", "metadata", "content"]);
export type AdminVisibility = z.infer<typeof adminVisibilitySchema>;

/**
 * Org admins see metadata and usage for their org's contexts, and content
 * only while the org's audit policy is on (after clamping to the instance
 * limits: pass the *effective* policy). Members are told when it is.
 */
export const orgAdminVisibility = (input: {
  readonly auditEnabled: boolean;
  readonly role: OrgRole | null;
}): AdminVisibility => {
  if (input.role !== "owner" && input.role !== "admin") {
    return "none";
  }
  return input.auditEnabled ? "content" : "metadata";
};

export interface AccessQuery {
  /**
   * For a chat: the caller's visibility as an admin of the chat's context
   * org (`orgAdminVisibility`). `content` reads like a viewer; nothing more.
   */
  readonly adminVisibility?: AdminVisibility;
  /** The caller's grants on this resource (or all of them; others are ignored). */
  readonly grants: readonly GrantFact[];
  /** Who the caller acts as (`loadPrincipals`, or direct principals plus `tree`). */
  readonly principals: readonly Principal[];
  readonly resource: ResourceFacts;
  readonly tree?: readonly TeamNode[];
  readonly userId: string;
}

/**
 * The owner, or a maintainer who is still in the library that owns the item:
 * someone who left the org (or the team) keeps no hold on what they
 * published there (D13, "survives your departure").
 */
const isManager = (query: AccessQuery): boolean => {
  const { resource, userId } = query;
  if (resource.resourceType === "conversation") {
    return resource.ownerId === userId;
  }
  const { owner } = resource;
  if (owner.type === "user") {
    return owner.id === userId;
  }
  const member = expandPrincipals(query.principals, query.tree ?? []).some(
    (principal) => principalKey(principal) === principalKey(owner)
  );
  return member && resource.maintainers.some((id) => id === userId);
};

/**
 * The highest level the caller has on the resource, from ownership, library
 * membership, grants and (chats) audit, or `null` for none.
 */
export const accessLevel = (query: AccessQuery): GrantPermission | null => {
  const { resource } = query;
  const tree = query.tree ?? [];
  const principals = expandPrincipals(query.principals, tree);
  const granted =
    effectiveGrants(principals, query.grants, []).find(
      (grant) =>
        grant.resourceType === resource.resourceType &&
        grant.resourceId === resource.resourceId
    )?.permission ?? null;

  if (resource.resourceType === "conversation") {
    // The owner is always an editor (D25); an auditing admin reads.
    if (resource.ownerId === query.userId) {
      return "editor";
    }
    const audit: GrantPermission | null =
      query.adminVisibility === "content" ? "viewer" : null;
    return higher("conversation", granted, audit);
  }

  if (isManager(query)) {
    return "edit";
  }
  // Publishing to a team or org library lets its members (and, by flow-down,
  // sub-team members) use the item; seeing its instructions takes a grant.
  const owner = principalKey(resource.owner);
  const member = principals.some(
    (principal) => principalKey(principal) === owner
  );
  return higher(resource.resourceType, granted, member ? "use" : null);
};

/** Whether the caller may do `action` to the resource. */
export const canAccess = (
  query: AccessQuery,
  action: AccessAction
): boolean => {
  if (action === "manage") {
    return isManager(query);
  }
  const needed = levelRank(query.resource.resourceType, action);
  if (needed < 0) {
    return false;
  }
  const level = accessLevel(query);
  return (
    level !== null && levelRank(query.resource.resourceType, level) >= needed
  );
};

// --- Team administration ---

/**
 * Whether someone may manage a team (rename, move, members, sub-teams): org
 * owners and admins anywhere, team admins in their team and below it.
 */
export const canManageTeam = (input: {
  readonly orgRole: OrgRole | null;
  /** Teams in this org where the caller is a team admin. */
  readonly teamAdminOf: readonly TeamId[];
  readonly teamId: TeamId;
  readonly tree: readonly TeamNode[];
}): boolean => {
  if (input.orgRole === "owner" || input.orgRole === "admin") {
    return true;
  }
  if (input.orgRole === null) {
    return false;
  }
  return ancestorsOf(input.teamId, input.tree).some((id) =>
    input.teamAdminOf.includes(id)
  );
};

/** Moving `teamId` under `parentId` would put a team inside its own subtree. */
export const wouldCreateCycle = (
  teamId: TeamId,
  parentId: TeamId | null,
  tree: readonly TeamNode[]
): boolean =>
  parentId !== null && descendantsOf(teamId, tree).includes(parentId);

/** Better Auth may store several roles comma-separated; the strongest wins. */
export const strongestOrgRole = (stored: string): OrgRole | null => {
  const roles = stored.split(",").map((role) => role.trim());
  return orgRoleSchema.options.find((role) => roles.includes(role)) ?? null;
};
