import type { UserSummary } from "@workspace/contract/schemas/tenancy";

import type { AgentOption, MentionCandidate } from "./schemas";

// A mention is an atomic node in the editor (id, kind, label); `doc.ts`
// turns those nodes into tokens with offsets when the draft is submitted.

/** Agents, then people, as `@` candidates. */
export const mentionCandidates = (
  agents: readonly AgentOption[],
  people: readonly UserSummary[]
): readonly MentionCandidate[] => [
  ...agents.map(
    (agent): MentionCandidate => ({
      description: agent.description || undefined,
      id: agent.id,
      kind: "agent",
      label: agent.name,
    })
  ),
  ...people.map(
    (person): MentionCandidate => ({
      description: person.email ?? undefined,
      id: person.id,
      kind: "user",
      label: person.name,
    })
  ),
];
