"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import type { AgentSource } from "@workspace/composer/schemas";
import type {
  Connector,
  LibraryItem,
} from "@workspace/contract/schemas/library";

import { useApi } from "@/app/(app)/_shared/api";
import { AGENT_TABS } from "@/app/(app)/(chat)/usable-agents";

// What Customize lists (193): the MCP servers this user can use (the same
// merged list settings shows) and the skills they can pick for a message,
// each once, with where it comes from.

const SKILL_LIST_LIMIT = 100;

export interface CustomizeSkill {
  readonly item: LibraryItem;
  /** Yours, shared with you, or from a team or org library. */
  readonly source: AgentSource;
}

/** Published skills from the three library tabs, each once, in tab order. Pure. */
export const usableSkillItems = (
  lists: readonly {
    readonly items: readonly LibraryItem[];
    readonly source: AgentSource;
  }[]
): readonly CustomizeSkill[] => {
  const seen = new Set<string>();
  return lists.flatMap(({ items, source }) =>
    items.flatMap((item) => {
      if (
        item.kind !== "skill" ||
        item.latestVersionId === null ||
        seen.has(item.id)
      ) {
        return [];
      }
      seen.add(item.id);
      return [{ item, source }];
    })
  );
};

export const useCustomizeServers = () => {
  const { query } = useApi();
  return useQuery(query.connectors.list.queryOptions({ input: {} }));
};

/** One list per tab, in `AGENT_TABS` order. */
const combineSkills = (
  lists: readonly {
    readonly data?: { readonly items: readonly LibraryItem[] };
    readonly isPending: boolean;
  }[]
): {
  readonly pending: boolean;
  readonly skills: readonly CustomizeSkill[];
} => ({
  pending: lists.some((list) => list.isPending),
  skills: usableSkillItems(
    AGENT_TABS.map((source, index) => ({
      items: lists[index]?.data?.items ?? [],
      source,
    }))
  ),
});

export const useCustomizeSkills = () => {
  const { query } = useApi();
  return useQueries({
    combine: combineSkills,
    queries: AGENT_TABS.map((tab) =>
      query.library.list.queryOptions({
        input: { kind: "skill", limit: SKILL_LIST_LIMIT, tab },
      })
    ),
  });
};

/** Installed, as the panel lists them: servers that are on and usable. */
export const installedServers = (
  servers: readonly Connector[]
): readonly Connector[] =>
  servers.filter(
    (server) => server.enabled && server.availability.state !== "unconfigured"
  );
