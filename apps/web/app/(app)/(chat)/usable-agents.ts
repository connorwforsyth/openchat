import type { AgentOption, AgentSource } from "@workspace/composer/schemas";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { LibraryItem } from "@workspace/contract/schemas/library";
import type {
  ChatContext,
  Principal,
} from "@workspace/contract/schemas/tenancy";

// The agents a person can chat with (D13), for the composer's picker: their
// own, those shared with them, and those in their teams' and orgs' libraries,
// each once, in that order. Only published agents answer a chat (drafts are
// for the builder's test chat), so the rest aren't offered. Pure.

export interface UsableAgents {
  readonly agents: readonly AgentOption[];
  /** Who owns each: a team or org library's agent starts its chat there (D17). */
  readonly owners: ReadonlyMap<LibraryItemId, Principal>;
}

export const AGENT_TABS: readonly AgentSource[] = [
  "mine",
  "shared",
  "libraries",
];

export const usableAgents = (
  lists: readonly {
    readonly items: readonly LibraryItem[];
    readonly source: AgentSource;
  }[]
): UsableAgents => {
  const agents: AgentOption[] = [];
  const owners = new Map<LibraryItemId, Principal>();
  for (const { items, source } of lists) {
    for (const item of items) {
      if (
        item.kind !== "agent" ||
        item.latestVersionId === null ||
        owners.has(item.id)
      ) {
        continue;
      }
      owners.set(item.id, item.owner);
      agents.push({
        description: item.description,
        icon: item.icon,
        id: item.id,
        name: item.name,
        source,
      });
    }
  }
  return { agents, owners };
};

/**
 * The chat context an agent's owner suggests: its team or org, when that's
 * one of the contexts the person can pick. `null` leaves the context alone.
 */
export const contextForOwner = (
  owner: Principal | undefined,
  options: readonly { readonly context: ChatContext }[]
): ChatContext | null => {
  if (!owner || owner.type === "user") {
    return null;
  }
  return (
    options.find(
      ({ context }) => context.type === owner.type && context.id === owner.id
    )?.context ?? null
  );
};
