import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  type AutoRoute,
  routeAutoModel,
} from "@workspace/ai/decider/auto-route";
import { FILE_SEARCH_TOOL } from "@workspace/ai/decider/retrieval-gate";
import type { KeyStore } from "@workspace/ai/keys/key-store";
import {
  type ChatKeys,
  type KeyContext,
  type KeyPolicy,
  resolveChatKeys,
} from "@workspace/ai/keys/resolve";
import type { Decider } from "@workspace/ai/ports/decider";
import type {
  ProviderCredentials,
  ProviderRegistry,
} from "@workspace/ai/ports/provider-registry";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import { resolveTools } from "@workspace/ai/tools/resolve";
import { buildToolSet, type McpToolSource } from "@workspace/ai/tools/tool-set";
import type { AppConfig } from "@workspace/config/schema";
import type {
  LibraryItemId,
  LibraryVersionId,
  OrgId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { KeyScope } from "@workspace/contract/schemas/keys";
import {
  AUTO_MODEL,
  type ModelParameters,
  type ModelRef,
  type ModelSelector,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type { ProposedEdit, RunError } from "@workspace/contract/schemas/runs";
import type { OrgPolicy } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { listReadableIndexedFileIds } from "@workspace/db/queries/files";
import { resolvePublishedVersion } from "@workspace/db/queries/library";
import { teamLineage } from "@workspace/db/queries/teams";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";

import { actorFor } from "../context";
import { canUseLibraryItem } from "../library/router";
import { draftFor } from "./drafts";
import {
  gateTurnTools,
  type KnowledgeDeps,
  type RetrievalGateDeps,
  withFileSearch,
} from "./retrieval";
import {
  chatSandboxApproval,
  type PausedCall,
  SANDBOX_TOOLS,
  type SandboxToolRequest,
  type SandboxToolSource,
  type ToolReviews,
  type TurnSandbox,
  withSandboxTools,
} from "./sandbox";

// What a run answers with (PLAN.md §8 steps 3.2–3.4): the target resolved to
// a model and the key that pays for it, plus the agent's instructions and
// tools. The executor takes a `TurnResolver` so tests can hand it a mock
// model; `createTurnResolver` is the production one, over app.config.yaml,
// the provider registry and the key store.

export interface Turn {
  readonly agent: {
    readonly id: LibraryItemId;
    readonly versionId: LibraryVersionId;
  } | null;
  readonly instructions?: string;
  readonly model: LanguageModelV4;
  /** Whose key pays; `null` for a keyless local provider. */
  readonly paidBy: KeyScope | null;
  readonly parameters?: ModelParameters;
  /** What a call paused for approval would change (sandbox `write`/`edit`), for `PendingApproval.edits`. */
  readonly proposeEdits?: (
    call: PausedCall
  ) => Promise<readonly ProposedEdit[] | undefined>;
  readonly resolvedModel: ModelRef;
  readonly toolApproval?: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools?: ToolSet;
}

/** Who is asking and in which chat context: what key resolution needs. */
export interface ModelCaller {
  readonly context: RunStart["context"];
  readonly userId: RunStart["createdBy"];
}

export interface LoadedModel {
  readonly model: LanguageModelV4;
  readonly paidBy: KeyScope | null;
  readonly resolvedModel: ModelRef;
}

/** A selector (ref, alias or `auto`) to a model and the key that pays for it. */
export type ModelLoader = (
  caller: ModelCaller,
  selector: ModelSelector,
  options: { readonly signal?: AbortSignal; readonly state: DeciderState }
) => Promise<Result<LoadedModel, RunError>>;

export interface TurnOptions {
  /** Decisions on the calls a resumed pass executes (per-hunk reviews, D16). */
  readonly reviews?: ToolReviews;
  readonly signal?: AbortSignal;
  readonly state: DeciderState;
}

export type TurnResolver = (
  run: RunStart,
  options: TurnOptions
) => AsyncResult<Turn, RunError>;

export interface TurnResolverDeps {
  /** Built-in tools this instance serves (web search, file search, …), from their workstreams. */
  readonly builtins?: Readonly<Record<string, Tool>>;
  readonly config: Pick<AppConfig, "models" | "policies"> &
    Partial<Pick<AppConfig, "decider">>;
  readonly db: Db;
  /**
   * The Decider (D15) paid for by the caller's keys in this chat's context,
   * like any other model call (D17). Used for `auto` routing and the
   * retrieval gate unless `routeAuto` or `retrieval` override it.
   */
  readonly decider?: (keys: ChatKeys) => Decider;
  readonly keyStore: KeyStore;
  /**
   * `file_search` over an agent's knowledge files and the chat's
   * attachments (036); leave out when `embeddings.model` isn't set.
   */
  readonly knowledge?: KnowledgeDeps;
  /** MCP tools (ticket 018), the same for every caller. */
  readonly mcp?: McpToolSource;
  /** MCP tools as one user sees them (per-user OAuth connections); wins over `mcp`. */
  readonly mcpFor?: (userId: UserId) => McpToolSource;
  /**
   * The org's effective policy (`org_settings` clamped by the instance), for
   * the personal-key fallback. Without it the conservative default holds.
   */
  readonly orgPolicy?: (
    orgId: OrgId
  ) => Promise<Pick<OrgPolicy, "personalKeyFallback">>;
  readonly registry: ProviderRegistry;
  /** The Decider's retrieval gate (D15); without it retrieval tools are always offered. */
  readonly retrieval?: RetrievalGateDeps;
  /** Routes `auto` (the Decider); leave out when `models.auto` is off. */
  readonly routeAuto?: (
    state: DeciderState,
    signal?: AbortSignal
  ) => Promise<Result<AutoRoute, { readonly type: "auto_disabled" }>>;
  /**
   * The chat's sandbox tools (019), bound by the shell; without it no run
   * gets `bash`, `read`, `write`, `edit` or `preview`.
   */
  readonly sandbox?: SandboxToolSource;
}

const unavailable = (provider: string | null): RunError => ({
  code: "provider_unavailable",
  message: provider
    ? `No key for ${provider} is available in this chat.`
    : "No model is available in this chat.",
  retryable: false,
});

const keyContextFor = async (
  db: Db,
  { context, userId }: ModelCaller
): Promise<KeyContext | null> => {
  switch (context.type) {
    case "personal":
      return { type: "personal", userId };
    case "org":
      return { orgId: context.id, type: "org", userId };
    case "team": {
      const lineage = await teamLineage(db, context.id);
      const [first, ...rest] = lineage?.path ?? [];
      return lineage && first
        ? {
            orgId: lineage.orgId,
            teamPath: [first, ...rest],
            type: "team",
            userId,
          }
        : null;
    }
    default:
      return context satisfies never;
  }
};

type KeyDeps = Pick<
  TurnResolverDeps,
  "config" | "db" | "keyStore" | "orgPolicy"
>;

/**
 * The keys that pay for `caller`'s calls in their chat context (D17), per
 * provider; `null` when the context no longer exists. A key store outage
 * reads as no keys: keyless local providers still work.
 */
export const chatKeysFor = async (
  deps: KeyDeps,
  caller: ModelCaller,
  signal?: AbortSignal
): Promise<ChatKeys | null> => {
  const keyContext = await keyContextFor(deps.db, caller);
  if (!keyContext) {
    return null;
  }
  const policy: KeyPolicy = {
    instance: deps.config.policies,
    org:
      keyContext.type === "personal" || !deps.orgPolicy
        ? null
        : await deps.orgPolicy(keyContext.orgId),
  };
  const keys = await resolveChatKeys(keyContext, deps.keyStore, policy, {
    signal,
  });
  return keys.ok ? keys.value : {};
};

export const createModelLoader = (
  deps: Pick<
    TurnResolverDeps,
    | "config"
    | "db"
    | "decider"
    | "keyStore"
    | "orgPolicy"
    | "registry"
    | "routeAuto"
  >
): ModelLoader => {
  const { config, registry } = deps;

  const routeAuto = (
    caller: ModelCaller,
    keys: ChatKeys,
    state: DeciderState,
    signal: AbortSignal | undefined
  ): Promise<Result<AutoRoute, { readonly type: "auto_disabled" }>> => {
    if (deps.routeAuto) {
      return deps.routeAuto(state, signal);
    }
    if (!(deps.decider && config.decider)) {
      return Promise.resolve(err({ type: "auto_disabled" }));
    }
    return routeAutoModel({
      config: { decider: config.decider, models: config.models },
      context: { userId: caller.userId },
      decider: deps.decider(keys),
      signal,
      state,
    });
  };

  const route = async (
    caller: ModelCaller,
    keys: ChatKeys,
    selector: ModelSelector,
    state: DeciderState,
    signal: AbortSignal | undefined
  ): Promise<Result<ModelRef, RunError>> => {
    let chosen = selector;
    if (selector === AUTO_MODEL) {
      const routed = await routeAuto(caller, keys, state, signal);
      if (!routed.ok) {
        return err(unavailable(null));
      }
      chosen = routed.value.selector;
    }
    const resolved = registry.resolve(chosen);
    return resolved.ok ? resolved : err(unavailable(null));
  };

  return async (caller, selector, { signal, state }) => {
    const keys = await chatKeysFor(deps, caller, signal);
    if (!keys) {
      return err(unavailable(null));
    }
    const ref = await route(caller, keys, selector, state, signal);
    if (!ref.ok) {
      return ref;
    }
    const provider = parseModelRef(ref.value)?.provider ?? ref.value;
    const credentials: ProviderCredentials | undefined = keys[provider];
    const model = registry.languageModel(ref.value, credentials);
    return model.ok
      ? ok({
          model: model.value,
          paidBy: credentials?.source ?? null,
          resolvedModel: ref.value,
        })
      : err(unavailable(provider));
  };
};

/** Attachments one plain chat checks for before offering `file_search`. */
const ATTACHMENT_PROBE = 1;

export const createTurnResolver = (deps: TurnResolverDeps): TurnResolver => {
  const { db } = deps;
  const loadModel = createModelLoader(deps);

  /**
   * The retrieval gate for this caller: the configured one, or the Decider
   * on the caller's keys. `undefined` leaves every retrieval tool offered.
   */
  const gateFor = async (
    caller: ModelCaller,
    signal: AbortSignal | undefined
  ): Promise<RetrievalGateDeps | undefined> => {
    if (deps.retrieval) {
      return deps.retrieval;
    }
    if (!(deps.decider && deps.config.decider)) {
      return;
    }
    const keys = await chatKeysFor(deps, caller, signal);
    return keys
      ? {
          decider: deps.decider(keys),
          threshold: deps.config.decider.thresholds.needsRetrieval,
        }
      : undefined;
  };

  /**
   * A plain model chat (no agent) searches its own attachments (025): the
   * tool is offered only once the chat has an indexed file the caller can
   * read, so a chat without files isn't handed a tool it can't use.
   */
  const attachmentTools = async (
    run: RunStart,
    caller: ModelCaller,
    { signal, state }: { signal?: AbortSignal; state: DeciderState }
  ): Promise<Pick<Turn, "toolApproval" | "tools">> => {
    if (!deps.knowledge) {
      return {};
    }
    const viewer = await actorFor(db, { userId: run.createdBy });
    const attached = await listReadableIndexedFileIds(db, viewer, {
      conversationId: run.conversationId,
      limit: ATTACHMENT_PROBE,
    });
    if (attached.length === 0) {
      return {};
    }
    const searchable = await withFileSearch(db, deps.knowledge, run, {
      knowledgeFileIds: [],
      tools: [FILE_SEARCH_TOOL],
    });
    const gated = await gateTurnTools(
      await gateFor(caller, signal),
      run,
      { toolApproval: {}, tools: { ...searchable.builtins } },
      { signal, state }
    );
    return { toolApproval: gated.toolApproval, tools: gated.tools };
  };

  /** The chat's sandbox for this turn, unless the composer turned it off. */
  const sandboxFor = async (
    run: RunStart,
    requested: SandboxToolRequest["requested"],
    { reviews, signal }: Pick<TurnOptions, "reviews" | "signal">
  ): Promise<TurnSandbox | null> => {
    if (!deps.sandbox || run.options.sandbox === "off") {
      return null;
    }
    return await deps.sandbox({
      requested,
      reviews: reviews ?? new Map(),
      run,
      signal,
    });
  };

  /**
   * A plain chat with a sandbox attached (or switched on for this turn)
   * gets its tools (D7); file changes ask, so each is reviewed before it
   * lands.
   */
  const chatSandboxTools = async (
    run: RunStart,
    options: Pick<TurnOptions, "reviews" | "signal">
  ): Promise<Pick<Turn, "proposeEdits" | "toolApproval" | "tools">> => {
    const sandbox = await sandboxFor(
      run,
      run.options.sandbox === "on" ? "default" : null,
      options
    );
    return sandbox === null
      ? {}
      : {
          proposeEdits: sandbox.proposeEdits,
          toolApproval: chatSandboxApproval(sandbox.tools),
          tools: { ...sandbox.tools },
        };
  };

  /** A plain model chat: the model, plus its attachments' and sandbox's tools. */
  const modelTurn = async (
    run: RunStart,
    target: Extract<RunStart["target"], { type: "model" }>,
    { reviews, signal, state }: TurnOptions
  ): AsyncResult<Turn, RunError> => {
    const caller = { context: run.context, userId: run.createdBy };
    const loaded = await loadModel(caller, target.model, { signal, state });
    if (!loaded.ok) {
      return loaded;
    }
    const attached = await attachmentTools(run, caller, { signal, state });
    const sandbox = await chatSandboxTools(run, { reviews, signal });
    const tools = { ...sandbox.tools, ...attached.tools };
    return ok({
      agent: null,
      parameters: target.parameters,
      ...loaded.value,
      proposeEdits: sandbox.proposeEdits,
      toolApproval: { ...sandbox.toolApproval, ...attached.toolApproval },
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    });
  };

  return async (run, options) => {
    const { reviews, signal, state } = options;
    const { target } = run;
    const caller = { context: run.context, userId: run.createdBy };
    if (target.type === "model") {
      return modelTurn(run, target, options);
    }

    // An agent: its latest published version unless the run pins one, or
    // its draft for someone who can edit it (the builder's test chat, 033).
    // The draft is read now, as the run starts, so a saved edit shows up
    // in the very next turn. `createRun` checked the caller may `edit` the
    // draft or `use` the published agent (032); checked again here because
    // a queued or resumed run starts later, and access can be revoked (or
    // its maintainer leave the library) in between.
    const draft = await draftFor(db, run.createdBy, target);
    if (!draft.ok) {
      return err({
        code: "internal",
        message: "You can't run that agent's draft.",
        retryable: false,
      });
    }
    if (
      draft.value === null &&
      !(await canUseLibraryItem(db, run.createdBy, "agent", target.id))
    ) {
      return err({
        code: "internal",
        message: "You no longer have access to that agent.",
        retryable: false,
      });
    }
    const version = draft.value
      ? ok(draft.value)
      : await resolvePublishedVersion(db, "agent", target.id, target.versionId);
    if (!version.ok) {
      return err({
        code: "internal",
        message: "That agent has no published version.",
        retryable: false,
      });
    }
    const { definition } = version.value;
    const loaded = await loadModel(caller, definition.model, { signal, state });
    if (!loaded.ok) {
      return loaded;
    }
    const searchable = await withFileSearch(
      db,
      deps.knowledge,
      run,
      definition
    );
    // The version's sandbox (the chat's own if one is attached); `null`
    // means no sandbox tools (contract `AgentDefinition.sandboxProvider`).
    const sandbox = definition.sandboxProvider
      ? await sandboxFor(run, definition.sandboxProvider, { reviews, signal })
      : null;
    // The per-turn `file_search` wins over a static one: only it is scoped
    // to this requester, chat and agent.
    const builtins = {
      ...deps.builtins,
      ...sandbox?.tools,
      ...searchable.builtins,
    };
    const plan = resolveTools(
      sandbox === null
        ? searchable.agent
        : withSandboxTools(searchable.agent, sandbox),
      {
        builtins: new Set(Object.keys(builtins)),
        modelSupportsTools: true,
        sandboxTools: new Set(SANDBOX_TOOLS),
      },
      // MCP grants come with 018; until then an agent's own servers are used.
      { mcpServers: new Set(definition.mcpServers.map((server) => server.id)) }
    );
    const toolSet = await buildToolSet(
      plan,
      { builtins, mcp: deps.mcpFor?.(run.createdBy) ?? deps.mcp },
      { signal }
    );
    const gated = await gateTurnTools(
      await gateFor(caller, signal),
      run,
      toolSet,
      { signal, state }
    );
    return ok({
      ...loaded.value,
      agent: { id: target.id, versionId: version.value.id },
      instructions: definition.instructions,
      parameters: definition.parameters,
      proposeEdits: sandbox?.proposeEdits,
      toolApproval: gated.toolApproval,
      tools: gated.tools,
    });
  };
};
