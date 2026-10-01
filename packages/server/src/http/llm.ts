import { routeAutoModel } from "@workspace/ai/decider/auto-route";
import type { ChatKeys } from "@workspace/ai/keys/resolve";
import { llmProxyErrorResponse } from "@workspace/ai/llm-proxy/errors";
import {
  handleLlmProxy,
  type LlmProxyDeps,
  type LlmUsageEvent,
  llmProxyResponse,
} from "@workspace/ai/llm-proxy/handle";
import { usageCost } from "@workspace/config/prices";
import type { LlmUsage } from "@workspace/contract/schemas/llm";
import { llmProxyRequestSchema } from "@workspace/contract/schemas/llm";
import type { TokenUsage } from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import type { StoredContext } from "@workspace/db/queries/conversations";
import { recordTransaction } from "@workspace/db/queries/usage";
import { ok } from "@workspace/shared/result";
import type { Hono } from "hono";

import { type Actor, actorFor, type SessionResolver } from "../context";
import {
  type BudgetCheck,
  chargedBy,
  storeContext,
} from "../runs/chat-context";
import { chatKeysFor, type TurnResolverDeps } from "../runs/turn";

// `POST /api/llm` (D7, contract README "The model proxy"): one model call on
// the server's keys for a client running its own agent loop (desktop
// cowork). 013's `handleLlmProxy` does the call; this route adds what it
// leaves to the route: the caller (session cookie or `Authorization:
// Bearer`, both through the auth session lookup), membership of the chat
// context, the budget check, the context's keys (`resolveChatKeys`, D17)
// and recording usage against the caller and the context.

export const LLM_PROXY_PATH = "/api/llm";

export interface LlmRouteDeps
  extends Pick<
    TurnResolverDeps,
    "config" | "decider" | "keyStore" | "orgPolicy" | "registry"
  > {
  readonly budget: BudgetCheck;
  readonly db: Db;
  /** Failures to record usage; never given secrets. */
  readonly report: (message: string, cause: unknown) => void;
  readonly resolveSession: SessionResolver;
}

/** `LanguageModelV4Usage` as a transaction's token counts. */
export const tokenUsageOf = (usage: LlmUsage): TokenUsage => ({
  cachedInputTokens: usage.inputTokens.cacheRead,
  inputTokens: usage.inputTokens.total ?? 0,
  outputTokens: usage.outputTokens.total ?? 0,
  reasoningTokens: usage.outputTokens.reasoning,
});

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    // Not JSON: the handler answers BAD_REQUEST like any other bad body.
    return null;
  }
};

/** Records one proxied call against the caller and the context. */
const usageRecorder =
  (deps: LlmRouteDeps, actor: Actor, context: StoredContext) =>
  (event: LlmUsageEvent): void => {
    const { usage } = event;
    if (!usage) {
      return;
    }
    const record = async () => {
      const charged = await chargedBy(deps.db, actor.userId, context);
      if (!charged) {
        return;
      }
      const tokens = tokenUsageOf(usage);
      await recordTransaction(deps.db, {
        context,
        // Priced from `models.prices`, as for runs; 0 when the model has no price.
        costMicros: usageCost(
          deps.config.models.prices,
          event.resolvedModel,
          tokens
        ).costMicros,
        kind: "chat",
        model: event.resolvedModel,
        orgId: charged.orgId,
        paidBy: event.source ?? { type: "instance" },
        usage: tokens,
        userId: actor.userId,
      });
    };
    record().catch((cause: unknown) =>
      deps.report("couldn't record model proxy usage", cause)
    );
  };

/** `auto` through the Decider on the keys that pay for this context. */
const autoRouter = (
  deps: LlmRouteDeps,
  actor: Actor,
  keys: ChatKeys
): LlmProxyDeps["routeAuto"] => {
  const { decider } = deps;
  const settings = deps.config.decider;
  if (!(decider && settings)) {
    return;
  }
  return (state, signal) =>
    routeAutoModel({
      config: { decider: settings, models: deps.config.models },
      context: { userId: actor.userId },
      decider: decider(keys),
      signal,
      state,
    });
};

export const handleLlmRoute = async (
  deps: LlmRouteDeps,
  request: Request
): Promise<Response> => {
  const session = await deps.resolveSession(request);
  if (!session) {
    return llmProxyErrorResponse({ code: "UNAUTHORIZED" });
  }
  const body = await readJson(request);
  const parsed = llmProxyRequestSchema.safeParse(body);
  if (!parsed.success) {
    // The handler words the BAD_REQUEST (it parses before calling anything).
    return llmProxyResponse(
      await handleLlmProxy(body, {
        recordUsage: () => undefined,
        registry: deps.registry,
        resolveKeys: () => Promise.resolve(ok({})),
      })
    );
  }
  const { context } = parsed.data;
  const actor = await actorFor(deps.db, session);
  const stored = await storeContext(deps.db, actor, context);
  if (!stored.ok) {
    return llmProxyErrorResponse({ code: "FORBIDDEN" });
  }
  const spent = await deps.budget(actor, stored.value);
  if (!spent.ok) {
    return llmProxyErrorResponse({
      code: "BUDGET_EXCEEDED",
      data: spent.error,
    });
  }
  const keys =
    (await chatKeysFor(
      deps,
      { context, userId: actor.userId },
      request.signal
    )) ?? {};
  const result = await handleLlmProxy(
    parsed.data,
    {
      recordUsage: usageRecorder(deps, actor, stored.value),
      registry: deps.registry,
      resolveKeys: () => Promise.resolve(ok(keys)),
      routeAuto: autoRouter(deps, actor, keys),
    },
    { signal: request.signal }
  );
  return llmProxyResponse(result);
};

export const mountLlmRoute = (app: Hono, deps: LlmRouteDeps) => {
  app.post(LLM_PROXY_PATH, (c) => handleLlmRoute(deps, c.req.raw));
};
