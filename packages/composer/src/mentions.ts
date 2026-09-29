import type { UserSummary } from "@workspace/contract/schemas/tenancy";

import type {
  AgentOption,
  FileCandidate,
  MentionCandidate,
  WorkspacePath,
} from "./schemas";

// A mention is an atomic node in the editor (id, kind, label); `doc.ts`
// turns those nodes into tokens with offsets when the draft is submitted.

/**
 * A workspace file as a candidate: its name to read, its folder as the hint.
 * A path ending in `/` has no name of its own, so it's shown whole.
 */
export const fileCandidate = (path: WorkspacePath): FileCandidate => {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  if (name === "") {
    return { kind: "file", label: path, path };
  }
  return slash > 0
    ? { description: path.slice(0, slash), kind: "file", label: name, path }
    : { kind: "file", label: name, path };
};

/** Agents, then people, then workspace files, as `@` candidates. */
export const mentionCandidates = (
  agents: readonly AgentOption[],
  people: readonly UserSummary[],
  files: readonly WorkspacePath[] = []
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
  ...files.map(fileCandidate),
];

/** A stable key per candidate: files have a path where the others have an id. */
export const candidateKey = (candidate: MentionCandidate): string =>
  candidate.kind === "file"
    ? `file:${candidate.path}`
    : `${candidate.kind}:${candidate.id}`;
