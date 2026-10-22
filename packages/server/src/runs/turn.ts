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
import { chipsOf } from "@workspace/ai/messages/chips";
import { workspaceFileRefs } from "@workspace/ai/messages/workspace-file";
import type { Decider } from "@workspace/ai/ports/decider";
import type {
  ProviderCredentials,
  ProviderRegistry,
} from "@workspace/ai/ports/provider-registry";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import { LOAD_ARTIFACT_GUIDE_TOOL } from "@workspace/ai/prompts/artifact-guides";
import type { PromptFile } from "@workspace/ai/prompts/codegen";
import { composeInstructions } from "@workspace/ai/prompts/compose";
import { BASE, FRAGMENTS } from "@workspace/ai/prompts/generated";
import { fillPrompt } from "@workspace/ai/prompts/template";
import { identityOf } from "@workspace/ai/providers/reasoning";
import type { DiscoveringRegistry } from "@workspace/ai/providers/registry";
import {
  runSettings,
  withRunSettings,
} from "@workspace/ai/providers/run-settings";
import { ARTIFACT_TOOLS } from "@workspace/ai/tools/artifacts";
import { GENERATE_IMAGE_TOOL } from "@workspace/ai/tools/registry/generate-image";
import { loadArtifactGuideTool } from "@workspace/ai/tools/registry/load-artifact-guide";
import {
  PUBLISH_SKILL_TOOL,
  SKILL_AUTHORING_TOOLS,
} from "@workspace/ai/tools/registry/skill-authoring";
import { toAiSdkTool } from "@workspace/ai/tools/registry/to-ai-sdk";
import { resolveTools } from "@workspace/ai/tools/resolve";
import { buildToolSet, type McpToolSource } from "@workspace/ai/tools/tool-set";
import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import type { AppConfig } from "@workspace/config/schema";
import type {
  ConversationId,
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
import { getMessage } from "@workspace/db/queries/messages";
import { teamLineage } from "@workspace/db/queries/teams";
import type { McpSelection } from "@workspace/mcp/service";
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
import { chatImageTools, type ImageModels } from "./images";
import { approvedPlanFor } from "./plan-artifact";
import {
  gateTurnTools,
  type KnowledgeDeps,
  type RetrievalGateDeps,
  type WebSearchSource,
  webSearchTools,
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
import { type SkillFileReader, skillTurnParts, turnSkills } from "./skills";
import { artifactRequests, workspaceContext } from "./workspace-context";

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
  /** An unattended run's step and token budget (175); see `RunAgentInput.budget`. */
  readonly budget?: { readonly steps: number; readonly tokens: number };
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
  /** The loop ends after a step calling one of these (a scheduled run's `report`). */
  readonly stopAfterTools?: readonly string[];
  readonly toolApproval?: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools?: ToolSet;
  /**
   * Tools the turn withheld, with why (plan mode, 106): a call to one is
   * answered with the reason, as a tool error the model reads (131).
   */
  readonly unavailableTools?: Readonly<Record<string, string>>;
}

/** Who is asking and in which chat context: what key resolution needs. */
export interface ModelCaller {
  readonly context: RunStart["context"];
  readonly userId: RunStart["createdBy"];
}

export interface LoadedModel {
  readonly model: LanguageModelV4;
  readonly paidBy: KeyScope | null;
  /**
   * Whether the provider's catalog says the model reasons (105); unset when
   * it has no catalog or doesn't say.
   */
  readonly reasons?: boolean;
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
  /**
   * The artifact kinds this instance offers (125), whose instructions a turn
   * with the artifact tools is given. The built-in kinds when left out.
   */
  readonly artifactKinds?: ArtifactKindRegistry;
  /**
   * The chat's artifact tools (`create_artifact`, `update_artifact`) for one
   * run (078), bound to the database by `services.ts`.
   */
  readonly artifacts?: (run: RunStart) => Readonly<Record<string, Tool>>;
  /**
   * Artifacts used in the run's chat from elsewhere ("Use in chat", 124),
   * as an instructions section beside the `@file` mentions; `undefined`
   * when there are none.
   */
  readonly attachedArtifacts?: (run: RunStart) => Promise<string | undefined>;
  /** Built-in tools this instance serves, the same for every turn, from their workstreams. */
  readonly builtins?: Readonly<Record<string, Tool>>;
  /**
   * A discovering registry's catalogs (095), for whether an
   * OpenAI-compatible model reasons and so takes a thinking level (105).
   */
  readonly catalog?: DiscoveringRegistry["catalog"];
  readonly config: Pick<AppConfig, "models" | "policies"> &
    // `providers` says which adapter a ref runs on, for its thinking level
    // and fast tier (105); without it neither is sent.
    Partial<Pick<AppConfig, "decider" | "providers">>;
  readonly db: Db;
  /**
   * The Decider (D15) paid for by the caller's keys in this chat's context,
   * like any other model call (D17). Used for `auto` routing and the
   * retrieval gate unless `routeAuto` or `retrieval` override it.
   */
  readonly decider?: (keys: ChatKeys) => Decider;
  /**
   * The instance's image models (138), from the built registry; without
   * them no run gets `generate_image`. It's offered only when
   * `models.image` names one this chat's keys can pay for.
   */
  readonly images?: ImageModels;
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
   * What a run's user has on in its chat (`mcpSelectionFor`: the operator's
   * catalog, their library, their defaults and the chat's choices; 184,
   * 188). `enabled` is a plain chat's servers (078); an agent gets the
   * servers its version lists, less `disabled`; `excludedTools` leaves
   * switched-off tools out of both. Without it plain chats get no MCP tools.
   */
  readonly mcpSelectionFor?: (
    userId: UserId,
    conversationId: ConversationId
  ) => Promise<McpSelection>;
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
  /**
   * `create_skill`, `update_skill` and `publish_skill` for one run (128),
   * acting as its creator through the library's own rules; bound by
   * `services.ts`. Without it no run writes skills.
   */
  readonly skillAuthoring?: (run: RunStart) => Readonly<Record<string, Tool>>;
  /**
   * A skill's bundled file by upload id (127), for `load_skill`; the turn
   * has already settled access to the skill. Without it files can't be read.
   */
  readonly skillFiles?: SkillFileReader;
  /** `web_search` for a turn's model (D23); without it no run searches the web. */
  readonly webSearch?: WebSearchSource;
}

const unavailable = (provider: string | null): RunError => ({
  code: "provider_unavailable",
  message: provider
    ? `No key for ${provider} is available in this chat.`
    : "No model is available in this chat.",
  retryable: false,
});

const notOffered = (ref: string): RunError => ({
  code: "provider_unavailable",
  message: `${ref} isn't offered on this instance.`,
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
    | "catalog"
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
    if (!model.ok) {
      return err(unavailable(provider));
    }
    // The picker hides what a provider's patterns or catalog leave out; a
    // selector sent anyway is refused here (095).
    const offered = await registry.checkModel(ref.value, credentials, {
      signal,
    });
    if (!offered.ok) {
      return err(
        offered.error.type === "not_offered"
          ? notOffered(ref.value)
          : unavailable(provider)
      );
    }
    const reasons = await catalogSaysReasons(
      deps,
      ref.value,
      credentials,
      provider
    );
    return ok({
      model: model.value,
      paidBy: credentials?.source ?? null,
      ...(reasons === undefined ? {} : { reasons }),
      resolvedModel: ref.value,
    });
  };
};

/**
 * Whether an OpenAI-compatible provider's catalog says the model reasons;
 * native providers' SDKs know their own models, so they aren't asked.
 */
const catalogSaysReasons = async (
  deps: Pick<TurnResolverDeps, "catalog" | "config">,
  ref: ModelRef,
  credentials: ProviderCredentials | undefined,
  provider: string
): Promise<boolean | undefined> => {
  if (
    !deps.catalog ||
    deps.config.providers?.[provider]?.type !== "openai-compatible"
  ) {
    return;
  }
  const models = await deps.catalog(provider, credentials).catch(() => null);
  const modelId = parseModelRef(ref)?.modelId;
  return models?.find((model) => model.id === modelId)?.traits?.reasoning;
};

/** Attachments one plain chat checks for before offering `file_search`. */
const ATTACHMENT_PROBE = 1;

/**
 * MCP tools one plain chat is offered at most. Nobody curated the list, as
 * an agent's author does, and providers refuse a request with too many
 * tools (OpenAI stops at 128), so the rest are left out rather than the
 * turn failing.
 */
const CHAT_MCP_TOOL_LIMIT = 100;

const NO_MCP_SELECTION: McpSelection = {
  disabled: new Set(),
  enabled: [],
  excludedTools: new Map(),
};

/**
 * Artifact tools save something into the chat, so they ask, like the
 * sandbox's file changes (`FILE_CHANGE_TOOLS`), unless an agent sets them
 * to `auto` by name.
 */
const ARTIFACT_APPROVALS = Object.fromEntries(
  ARTIFACT_TOOLS.map((name) => [name, "ask" as const])
);

/**
 * The skill tools change the person's library, so creating and editing ask
 * unless an agent sets them to `auto` by name; publishing changes what
 * other people get, so it always asks, whatever the agent says.
 */
const SKILL_APPROVALS = Object.fromEntries(
  SKILL_AUTHORING_TOOLS.map((name) => [name, "ask" as const])
);

export const createTurnResolver = (deps: TurnResolverDeps): TurnResolver => {
  const { db } = deps;
  const loadModel = createModelLoader(deps);
  const kinds = deps.artifactKinds ?? builtinArtifactKinds;

  /**
   * `load_artifact_guide` (160), offered beside the artifact tools but not
   * among them: everything `deps.artifacts` returns is held to "ask", and
   * this only reads the instance's kinds, so it never asks. Nothing when no
   * kind has a guide, or the instance has no artifact tools.
   */
  const artifactGuideTools = (): Readonly<Record<string, Tool>> => {
    const guides = kinds
      .list()
      .filter((definition) => definition.instructions !== "")
      .map((definition) => ({
        guide: definition.instructions,
        kind: definition.kind,
      }));
    return deps.artifacts && guides.length > 0
      ? {
          [LOAD_ARTIFACT_GUIDE_TOOL]: toAiSdkTool(loadArtifactGuideTool, {
            ports: { guides },
          }),
        }
      : {};
  };

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
    run: RunStart
  ): Promise<Readonly<Record<string, Tool>>> => {
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
    return searchable.builtins;
  };

  /**
   * A plain chat has no agent version to list MCP servers, so it gets every
   * server its caller may use (078), through the same `resolveTools` and
   * `buildToolSet` as an agent's, so a server that's down is skipped. Every
   * call asks first: nobody chose these servers for this chat, as an
   * agent's author does for a version, and a plain chat ran no MCP tool
   * before, so nothing here runs without a person's say (whether some may
   * is the permissions proposal's question, ticket 073). MCP is an extra:
   * if the servers can't be listed, the turn goes ahead without them.
   */
  /** What the run's user has on in its chat (184, 188). A failed read drops nothing. */
  const mcpSelection = async (run: RunStart): Promise<McpSelection> =>
    (await deps
      .mcpSelectionFor?.(run.createdBy, run.conversationId)
      .catch(() => undefined)) ?? NO_MCP_SELECTION;

  const chatMcpTools = async (
    run: RunStart,
    signal: AbortSignal | undefined
  ): Promise<Pick<Turn, "toolApproval" | "tools">> => {
    const mcp = deps.mcpFor?.(run.createdBy) ?? deps.mcp;
    const selection =
      mcp && deps.mcpSelectionFor ? await mcpSelection(run) : undefined;
    const ids = selection?.enabled;
    if (!(mcp && ids && ids.length > 0)) {
      return {};
    }
    const plan = resolveTools(
      {
        approvals: { default: "ask", tools: {} },
        mcpServers: ids.map((id) => ({ id })),
        sandboxProvider: null,
        tools: [],
      },
      { builtins: new Set(), modelSupportsTools: true },
      {
        mcpExcludedTools: selection.excludedTools,
        mcpServers: new Set(ids),
      }
    );
    const built = await buildToolSet(plan, { builtins: {}, mcp }, { signal });
    return {
      toolApproval: built.toolApproval,
      tools: Object.fromEntries(
        Object.entries(built.tools).slice(0, CHAT_MCP_TOOL_LIMIT)
      ),
    };
  };

  /** A plain chat's artifact tools: each call asks before it saves. */
  const chatArtifactTools = (
    run: RunStart
  ): Pick<Turn, "toolApproval" | "tools"> => {
    const tools = deps.artifacts?.(run);
    return tools
      ? {
          toolApproval: Object.fromEntries(
            Object.keys(tools).map((name) => [name, "user-approval" as const])
          ),
          tools: { ...tools },
        }
      : {};
  };

  /** A plain chat's skill tools (128): each call asks before it changes the library. */
  const chatSkillTools = (
    run: RunStart
  ): Pick<Turn, "toolApproval" | "tools"> => {
    const tools = deps.skillAuthoring?.(run);
    return tools
      ? {
          toolApproval: Object.fromEntries(
            Object.keys(tools).map((name) => [name, "user-approval" as const])
          ),
          tools: { ...tools },
        }
      : {};
  };

  /**
   * `generate_image` for this turn (138), bound to the caller's keys and the
   * chat's workspace; nothing without an image model they can pay for.
   */
  const imageTools = async (
    run: RunStart,
    sandbox: TurnSandbox | null,
    signal: AbortSignal | undefined
  ): Promise<Pick<Turn, "toolApproval" | "tools">> => {
    if (!deps.images) {
      return {};
    }
    const keys = await chatKeysFor(
      deps,
      { context: run.context, userId: run.createdBy },
      signal
    );
    return keys
      ? await chatImageTools(
          { config: deps.config, db, models: deps.images },
          run,
          keys,
          sandbox
        )
      : {};
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
   * Every plain chat has a workspace (D7): its tools are offered unless the
   * composer turned it off, and the first call creates it. File changes
   * ask, so each is reviewed before it lands.
   */
  const chatSandboxTools = async (
    run: RunStart,
    options: Pick<TurnOptions, "reviews" | "signal">
  ): Promise<
    Pick<Turn, "proposeEdits" | "toolApproval" | "tools"> & {
      readonly sandbox: TurnSandbox | null;
    }
  > => {
    const sandbox = await sandboxFor(run, "default", options);
    return sandbox === null
      ? { sandbox }
      : {
          proposeEdits: sandbox.proposeEdits,
          sandbox,
          toolApproval: chatSandboxApproval(sandbox.tools),
          tools: { ...sandbox.tools },
        };
  };

  /**
   * The `@file` mentions in the message this run answers, read from the
   * workspace as the turn starts (`workspace-context.ts`). `sandbox` is the
   * turn's workspace, or a thunk for one when the turn has no tools.
   */
  const mentionedFiles = async (
    run: RunStart,
    sandbox: () => Promise<TurnSandbox | null>
  ): Promise<string | undefined> => {
    const message = await getMessage(db, run.userMessageId);
    const refs = message.ok ? workspaceFileRefs(message.value.parts) : [];
    const files =
      refs.length === 0
        ? undefined
        : await workspaceContext(refs, (await sandbox())?.readFile);
    // Artifacts used in this chat from elsewhere ride along like mentions (124).
    const attached = await deps.attachedArtifacts?.(run);
    const requested = message.ok
      ? artifactRequests(chipsOf(message.value.parts))
      : undefined;
    return (
      [files, attached, requested].filter(Boolean).join("\n\n") || undefined
    );
  };

  /**
   * The instructions of the artifact kinds the model may create (125): a
   * kind works like a skill, so a turn that has the artifact tools is told
   * each kind's rules (Sites and, since 126, Documents). Kinds with none add
   * nothing, and a planning run gets none.
   */
  const kindInstructions = (
    tools: Readonly<Record<string, unknown>> | undefined
  ): readonly PromptFile[] =>
    tools && ARTIFACT_TOOLS.some((name) => name in tools)
      ? kinds.instructionFiles()
      : [];

  /** Whether the turn can load kinds' guides, so their full text can wait (160). */
  const guidesOnDemand = (
    tools: Readonly<Record<string, unknown>> | undefined
  ): boolean => tools !== undefined && LOAD_ARTIFACT_GUIDE_TOOL in tools;

  /**
   * Plan mode's instructions (106): a planning run is told it only reads
   * and what its plan must hold; a run that approves a plan gets the
   * version approved. Nothing for any other run, so its prompt is as before.
   */
  const planInstructions = async (
    run: RunStart
  ): Promise<readonly PromptFile[]> => {
    const { parts, source } = FRAGMENTS.plan;
    if (run.options.mode === "plan") {
      return [{ source, text: parts.planning }];
    }
    const approved = await approvedPlanFor(db, run);
    return approved === undefined
      ? []
      : [{ source, text: fillPrompt(parts.approved, { plan: approved }) }];
  };

  /**
   * A plain model chat: the model, plus its sandbox's tools, the caller's
   * MCP servers, the artifact tools, and retrieval (its attachments and the
   * web) where the gate lets it through. Ours win a clash of names.
   */
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
    const sandbox = await chatSandboxTools(run, { reviews, signal });
    const mcp = await chatMcpTools(run, signal);
    const artifacts = chatArtifactTools(run);
    const guides = artifactGuideTools();
    const authoring = chatSkillTools(run);
    const images = await imageTools(run, sandbox.sandbox, signal);
    const own = {
      ...mcp.tools,
      ...artifacts.tools,
      ...guides,
      ...authoring.tools,
      ...images.tools,
      ...sandbox.tools,
    };
    const retrieval = {
      ...webSearchTools(deps.webSearch, run, loaded.value.resolvedModel),
      ...(await attachmentTools(run)),
    };
    const gated =
      Object.keys(retrieval).length > 0
        ? await gateTurnTools(
            await gateFor(caller, signal),
            run,
            { toolApproval: {}, tools: retrieval },
            { signal, state }
          )
        : { toolApproval: {}, tools: {} };
    // Skills picked for the message (127): instructions, and `load_skill`
    // for the files they bundle.
    const skills = skillTurnParts(await turnSkills(db, run), deps.skillFiles);
    const tools = { ...own, ...gated.tools, ...skills.tools };
    const mentioned = await mentionedFiles(run, () =>
      Promise.resolve(sandbox.sandbox)
    );
    const planning = run.options.mode === "plan";
    const instructions = composeInstructions({
      base: BASE,
      // A planning run's own fragment says what it may do in the workspace.
      dynamic: [
        ...(sandbox.sandbox && !planning ? [FRAGMENTS.workspace] : []),
        ...(await planInstructions(run)),
      ],
      // A planning run can't make artifacts (126).
      kindGuidesOnDemand: guidesOnDemand(tools),
      kinds: planning ? [] : kindInstructions(tools),
      mentions: mentioned,
      skills: skills.sections,
    });
    // The run's thinking level and fast mode (105), where the model takes them.
    const { reasons, ...model } = loaded.value;
    const providerType =
      deps.config.providers?.[
        parseModelRef(model.resolvedModel)?.provider ?? ""
      ]?.type;
    const settings = providerType
      ? runSettings({
          ...identityOf(model.resolvedModel),
          options: run.options,
          providerType,
          reasons,
        })
      : {};
    return ok({
      agent: null,
      ...(instructions.sections.length > 0
        ? { instructions: instructions.text }
        : {}),
      parameters: target.parameters,
      ...model,
      model: withRunSettings(model.model, settings),
      proposeEdits: sandbox.proposeEdits,
      toolApproval: {
        ...mcp.toolApproval,
        ...artifacts.toolApproval,
        ...Object.fromEntries(
          Object.keys(guides).map((name) => [name, "not-applicable" as const])
        ),
        ...authoring.toolApproval,
        ...images.toolApproval,
        ...sandbox.toolApproval,
        ...gated.toolApproval,
        ...skills.toolApproval,
      },
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
      // An agent gets these when its version lists them by name.
      ...webSearchTools(deps.webSearch, run, loaded.value.resolvedModel),
      ...deps.artifacts?.(run),
      ...artifactGuideTools(),
      ...deps.skillAuthoring?.(run),
      // An agent gets `generate_image` when its version lists it (138).
      ...(await imageTools(run, sandbox, signal)).tools,
      ...sandbox?.tools,
      ...searchable.builtins,
    };
    const planned =
      sandbox === null
        ? searchable.agent
        : withSandboxTools(searchable.agent, sandbox);
    const selection = await mcpSelection(run);
    const plan = resolveTools(
      {
        ...planned,
        approvals: {
          ...planned.approvals,
          tools: {
            ...ARTIFACT_APPROVALS,
            // It only reads the instance's kinds (160).
            [LOAD_ARTIFACT_GUIDE_TOOL]: "auto",
            ...SKILL_APPROVALS,
            // Images cost more than a reply: they ask unless the instance
            // says `auto`, or the agent sets the tool to `auto` by name.
            [GENERATE_IMAGE_TOOL]: deps.config.models.image.approval,
            ...planned.approvals.tools,
            [PUBLISH_SKILL_TOOL]: "ask",
          },
        },
      },
      {
        builtins: new Set(Object.keys(builtins)),
        modelSupportsTools: true,
        sandboxTools: new Set(SANDBOX_TOOLS),
      },
      // MCP grants come with 018; until then an agent's own servers are
      // used, less any the user or the operator turned off (184), and
      // without the tools they switched off (188).
      {
        mcpExcludedTools: selection.excludedTools,
        mcpServers: new Set(
          definition.mcpServers
            .map((server) => server.id)
            .filter((id) => !selection.disabled.has(id))
        ),
      }
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
    // An agent without sandbox tools still reads mentions from a workspace
    // the chat already has.
    const mentioned = await mentionedFiles(run, () =>
      sandbox
        ? Promise.resolve(sandbox)
        : sandboxFor(run, null, { reviews, signal })
    );
    // The agent's own skills, listed for it to load (127), and any picked
    // for the message, whole.
    const skills = skillTurnParts(
      await turnSkills(db, run, definition.skills),
      deps.skillFiles
    );
    return ok({
      ...loaded.value,
      agent: { id: target.id, versionId: version.value.id },
      instructions: composeInstructions({
        agent: definition.instructions,
        base: BASE,
        dynamic: await planInstructions(run),
        // A planning run can't make artifacts.
        kindGuidesOnDemand: guidesOnDemand(gated.tools),
        kinds: run.options.mode === "plan" ? [] : kindInstructions(gated.tools),
        mentions: mentioned,
        skills: skills.sections,
      }).text,
      parameters: definition.parameters,
      proposeEdits: sandbox?.proposeEdits,
      toolApproval: { ...gated.toolApproval, ...skills.toolApproval },
      tools: { ...gated.tools, ...skills.tools },
    });
  };
};
