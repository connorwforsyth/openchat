import type { TeamId } from "@workspace/contract/schemas/common";
import type { Team } from "@workspace/contract/schemas/tenancy";

// The team tree (D17) arrives flat; the admin page nests it by `parentId`.

export interface TeamNode {
  readonly children: readonly TeamNode[];
  readonly depth: number;
  readonly team: Team;
}

const byName = (a: Team, b: Team) => a.name.localeCompare(b.name);

/**
 * Nested, siblings by name. A team whose parent isn't in the list (a stale
 * cache, a race with deletion) shows at the top level rather than vanishing.
 */
export const buildTeamTree = (teams: readonly Team[]): readonly TeamNode[] => {
  const ids = new Set(teams.map((team) => team.id));
  const childrenOf = (parent: TeamId | null, depth: number): TeamNode[] =>
    teams
      .filter((team) =>
        parent === null
          ? team.parentId === null || !ids.has(team.parentId)
          : team.parentId === parent
      )
      .sort(byName)
      .map((team) => ({
        children: depth > 32 ? [] : childrenOf(team.id, depth + 1),
        depth,
        team,
      }));
  return childrenOf(null, 0);
};

/** Depth-first, parents before children: the order the page lists them in. */
export const flattenTree = (nodes: readonly TeamNode[]): readonly TeamNode[] =>
  nodes.flatMap((node) => [node, ...flattenTree(node.children)]);

/** A team and everything under it: none of these can become its parent. */
export const subtreeIds = (
  teams: readonly Team[],
  root: TeamId
): ReadonlySet<TeamId> => {
  const found = new Set<TeamId>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const team of teams) {
      if (team.parentId && found.has(team.parentId) && !found.has(team.id)) {
        found.add(team.id);
        grew = true;
      }
    }
  }
  return found;
};
