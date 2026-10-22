import type { AgentOption, AgentSource } from "@workspace/composer/schemas";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  ChatContext,
  Principal,
} from "@workspace/contract/schemas/tenancy";

import { type TabItems, usableItems } from "./usable-items";

// The agents a person can chat with (D13), for the composer's picker and
// menu (see `usableItems`). Published agents answer any chat; the owner's
// own draft is offered too, in the menu only, where its chip runs that
// draft for one message. Pure.

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

export const usableAgents = (lists: readonly TabItems[]): UsableAgents => {
  const usable = usableItems(lists, "agent");
  return {
    agents: usable.map(({ draftVersion, item, source }) => ({
      description: item.description,
      icon: item.icon,
      id: item.id,
      name: item.name,
      source,
      ...(draftVersion ? { draftVersion } : {}),
    })),
    owners: new Map(usable.map(({ item }) => [item.id, item.owner])),
  };
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
