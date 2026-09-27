import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { AutoRoute } from "@workspace/ai/decider/auto-route";
import type { KeyStore } from "@workspace/ai/keys/key-store";
import {
  type KeyContext,
  type KeyPolicy,
  resolveChatKeys,
} from "@workspace/ai/keys/resolve";
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
import type { RunError } from "@workspace/contract/schemas/runs";
import type { Db } from "@workspace/db/client";
import { resolvePublishedVersion } from "@workspace/db/queries/library";
import { teamLineage } from "@workspace/db/queries/teams";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";

import { canUseLibraryItem } from "../library/router";
import { draftFor } from "./drafts";

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

export type TurnResolver = (
  run: RunStart,
  options: { readonly signal?: AbortSignal; readonly state: DeciderState }
) => AsyncResult<Turn, RunError>;

export interface TurnResolverDeps {
  /** Built-in tools this instance serves (web search, file search, …), from their workstreams. */
  readonly builtins?: Readonly<Record<string, Tool>>;
  readonly config: Pick<AppConfig, "models" | "policies">;
  readonly db: Db;
  readonly keyStore: KeyStore;
  /** MCP tools (ticket 018). */
  readonly mcp?: McpToolSource;
  readonly registry: ProviderRegistry;
  /** Routes `auto` (the Decider); leave out when `models.auto` is off. */
  readonly routeAuto?: (
    state: DeciderState,
    signal?: AbortSignal
  ) => Promise<Result<AutoRoute, { readonly type: "auto_disabled" }>>;
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

export const createModelLoader = (
  deps: Pick<
    TurnResolverDeps,
    "config" | "db" | "keyStore" | "registry" | "routeAuto"
  >
): ModelLoader => {
  const { config, db, registry } = deps;
  const policy: KeyPolicy = {
    instance: config.policies,
    // Org policy lives in `org_settings`, which the orgs workstream loads;
    // until then the conservative default (no personal-key fallback) holds.
    org: null,
  };

  const route = async (
    selector: ModelSelector,
    state: DeciderState,
    signal: AbortSignal | undefined
  ): Promise<Result<ModelRef, RunError>> => {
    let chosen = selector;
    if (selector === AUTO_MODEL) {
      const routed = deps.routeAuto
        ? await deps.routeAuto(state, signal)
        : err({ type: "auto_disabled" as const });
      if (!routed.ok) {
        return err(unavailable(null));
      }
      chosen = routed.value.selector;
    }
    const resolved = registry.resolve(chosen);
    return resolved.ok ? resolved : err(unavailable(null));
  };

  return async (caller, selector, { signal, state }) => {
    const ref = await route(selector, state, signal);
    if (!ref.ok) {
      return ref;
    }
    const provider = parseModelRef(ref.value)?.provider ?? ref.value;
    const keyContext = await keyContextFor(db, caller);
    if (!keyContext) {
      return err(unavailable(provider));
    }
    const keys = await resolveChatKeys(keyContext, deps.keyStore, policy, {
      signal,
    });
    const credentials: ProviderCredentials | undefined = keys.ok
      ? keys.value[provider]
      : undefined;
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

export const createTurnResolver = (deps: TurnResolverDeps): TurnResolver => {
  const { db } = deps;
  const loadModel = createModelLoader(deps);

  return async (run, { signal, state }) => {
    const { target } = run;
    const caller = { context: run.context, userId: run.createdBy };
    if (target.type === "model") {
      const loaded = await loadModel(caller, target.model, { signal, state });
      return loaded.ok
        ? ok({ agent: null, parameters: target.parameters, ...loaded.value })
        : loaded;
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
    const builtins = deps.builtins ?? {};
    const plan = resolveTools(
      definition,
      {
        builtins: new Set(Object.keys(builtins)),
        modelSupportsTools: true,
      },
      // MCP grants come with 018; until then an agent's own servers are used.
      { mcpServers: new Set(definition.mcpServers.map((server) => server.id)) }
    );
    const toolSet = await buildToolSet(
      plan,
      { builtins, mcp: deps.mcp },
      { signal }
    );
    return ok({
      ...loaded.value,
      agent: { id: target.id, versionId: version.value.id },
      instructions: definition.instructions,
      parameters: definition.parameters,
      toolApproval: toolSet.toolApproval,
      tools: toolSet.tools,
    });
  };
};
