import {
  FILE_SEARCH_TOOL,
  gateRetrieval,
  WEB_SEARCH_TOOL,
} from "@workspace/ai/decider/retrieval-gate";
import type { Decider } from "@workspace/ai/ports/decider";
import type { Embedder } from "@workspace/ai/ports/embedder";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { ModelRef } from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";

import { actorFor } from "../context";
import { fileSearchToolFor } from "../knowledge/file-search-tool";

// Retrieval in agent turns (ticket 036). An agent with knowledge files gets
// `file_search` over them plus the chat's attachments. The two are reached
// differently on purpose (D13): knowledge files through the agent's grant,
// so a `use`-only consumer can search them without being able to open
// them (they see cited passages, never the file), and attachments through
// the requester's own read access. The Decider's retrieval gate (D15) then
// drops the tool on turns that don't need it.

export interface KnowledgeDeps {
  readonly embedder: Embedder;
  /** Weakest match `file_search` returns; the tool's default otherwise. */
  readonly minScore?: number;
}

export interface RetrievalGateDeps {
  readonly decider: Decider;
  /** `decider.thresholds.needsRetrieval`. */
  readonly threshold: number;
}

type ToolAgent = Pick<AgentDefinition, "knowledgeFileIds" | "tools">;

/**
 * The agent with `file_search` switched on when it has knowledge files, and
 * the per-turn tool that serves it. Without an embedder nothing was indexed,
 * so there's nothing to search and the agent is left as it is.
 */
export const withFileSearch = async <A extends ToolAgent>(
  db: Db,
  knowledge: KnowledgeDeps | undefined,
  run: Pick<RunStart, "conversationId" | "createdBy">,
  agent: A
): Promise<{
  readonly agent: A;
  readonly builtins: Readonly<Record<string, Tool>>;
}> => {
  const wanted =
    agent.knowledgeFileIds.length > 0 || agent.tools.includes(FILE_SEARCH_TOOL);
  if (!(knowledge && wanted)) {
    return { agent, builtins: {} };
  }
  const viewer = await actorFor(db, { userId: run.createdBy });
  const searchTool = fileSearchToolFor({
    // The version's list was checked when it was saved and published
    // (017): these are the files the agent's grant lets its users search.
    agentFileIds: agent.knowledgeFileIds,
    conversationId: run.conversationId,
    db,
    embedder: knowledge.embedder,
    viewer,
    ...(knowledge.minScore === undefined
      ? {}
      : { minScore: knowledge.minScore }),
  });
  return {
    agent: {
      ...agent,
      tools: [...new Set([...agent.tools, FILE_SEARCH_TOOL])],
    },
    builtins: { [FILE_SEARCH_TOOL]: searchTool },
  };
};

/**
 * `web_search` for a turn on `model` (D23), bound by the shell over
 * `chooseWebSearch`: the provider's own search when the model has it,
 * otherwise ours over the configured backend, otherwise `null`.
 */
export type WebSearchSource = (model: ModelRef) => Tool | null;

/**
 * The turn's `web_search`, unless the composer turned it off for this
 * message. The Decider's gate (`gateTurnTools`) can still drop it; without
 * a Decider the model decides for itself whether to search.
 */
export const webSearchTools = (
  source: WebSearchSource | undefined,
  run: Pick<RunStart, "options">,
  model: ModelRef
): Readonly<Record<string, Tool>> => {
  if (!source || run.options.webSearch === "off") {
    return {};
  }
  const tool = source(model);
  return tool === null ? {} : { [WEB_SEARCH_TOOL]: tool };
};

const pick = <T>(
  record: Readonly<Record<string, T>>,
  keep: ReadonlySet<string>
): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => keep.has(name)));

/**
 * The turn's tools minus the retrieval tools the Decider says this turn
 * doesn't need. The gate only removes; with no opinion (or no Decider),
 * everything stays and the model decides for itself.
 */
export const gateTurnTools = async (
  gate: RetrievalGateDeps | undefined,
  run: Pick<RunStart, "conversationId" | "createdBy" | "options" | "runId">,
  turn: {
    readonly toolApproval: Readonly<Record<string, ToolApprovalStatus>>;
    readonly tools: ToolSet;
  },
  options: { readonly signal?: AbortSignal; readonly state: DeciderState }
): Promise<{
  readonly toolApproval: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools: ToolSet;
}> => {
  if (!gate) {
    return turn;
  }
  const gated = await gateRetrieval({
    activeTools: Object.keys(turn.tools),
    context: {
      conversationId: run.conversationId,
      runId: run.runId,
      userId: run.createdBy,
    },
    decider: gate.decider,
    // Memory goes into every private chat's instructions (`withChatMemory`);
    // there's no lookup here to gate.
    memory: false,
    options: run.options,
    signal: options.signal,
    state: options.state,
    threshold: gate.threshold,
  });
  const keep = new Set(gated.activeTools);
  return {
    toolApproval: pick(turn.toolApproval, keep),
    tools: pick(turn.tools, keep),
  };
};
