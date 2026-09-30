import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { KeyScope } from "@workspace/contract/schemas/keys";
import {
  type LlmProxyRequest,
  type LlmProxyResponse,
  type LlmUsage,
  llmProxyRequestSchema,
  llmProxyResponseSchema,
  llmUsageSchema,
} from "@workspace/contract/schemas/llm";
import {
  AUTO_MODEL,
  type ModelRef,
  type ModelSelector,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";

import type { AutoRoute } from "../decider/auto-route";
import { toRunError } from "../errors/run-error";
import type { KeyStoreError } from "../keys/key-store";
import type { ChatKeys } from "../keys/resolve";
import type { ProviderRegistry } from "../ports/provider-registry";
import {
  type LlmProxyError,
  llmProxyErrorResponse,
  validation,
} from "./errors";
import { toJson } from "./json";
import { checkPrompt, stateFromPrompt } from "./prompt";

// The model proxy (D7, contract `llm.ts`): one language-model call on the
// server's keys, for a client running its own agent loop. The route (014/025)
// authenticates, checks the caller is in `context`, rate-limits and checks the
// budget, then hands the raw body here. This parses it, resolves the model
// (aliases, `auto` through the Decider), picks the key for the context,
// calls `doGenerate` / `doStream` and answers JSON or SSE, recording usage
// once the call ends, however it ends.

export interface LlmUsageEvent {
  readonly context: ChatContext;
  /** Why the call ended: done, the client went away, or the provider failed. */
  readonly outcome: "cancelled" | "completed" | "failed";
  readonly resolvedModel: ModelRef;
  /** Whose key paid; `null` for a keyless local provider. */
  readonly source: KeyScope | null;
  /** `null` when the provider never reported any. */
  readonly usage: LlmUsage | null;
}

export interface LlmProxyDeps {
  /** Must not throw; a failure to record is the recorder's to log. */
  readonly recordUsage: (event: LlmUsageEvent) => void;
  readonly registry: ProviderRegistry;
  /** The caller's keys for `context` (`resolveChatKeys` with the user bound). */
  readonly resolveKeys: (
    context: ChatContext
  ) => AsyncResult<ChatKeys, KeyStoreError>;
  /** Routes `auto`; leave out when `models.auto` is off. */
  readonly routeAuto?: (
    state: DeciderState,
    signal?: AbortSignal
  ) => Promise<Result<AutoRoute, { readonly type: "auto_disabled" }>>;
}

export type LlmProxyReply =
  | {
      readonly body: LlmProxyResponse;
      readonly kind: "json";
      readonly resolvedModel: ModelRef;
    }
  | {
      readonly body: ReadableStream<Uint8Array>;
      readonly kind: "stream";
      readonly resolvedModel: ModelRef;
    };

/**
 * Call options that would reach other people's data on the instance's key:
 * OpenAI (and Azure) can continue a stored response or conversation by id.
 */
const DENIED_PROVIDER_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  azure: ["previousResponseId", "conversation"],
  openai: ["previousResponseId", "conversation"],
};

const safeProviderOptions = (
  options: LlmProxyRequest["providerOptions"]
): SharedV4ProviderOptions | undefined =>
  options &&
  Object.fromEntries(
    Object.entries(options).map(([provider, values]) => [
      provider,
      Object.fromEntries(
        Object.entries(values).filter(
          ([key]) => !DENIED_PROVIDER_OPTIONS[provider]?.includes(key)
        )
      ),
    ])
  );

const providerOf = (ref: ModelRef): string =>
  parseModelRef(ref)?.provider ?? ref;

const issuesOf = (error: {
  issues: readonly { message: string; path: readonly PropertyKey[] }[];
}) =>
  error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.map((key) =>
      typeof key === "symbol" ? String(key) : key
    ),
  }));

/** A failure before anything was sent, as a status the client can act on. */
const callFailed = (cause: unknown, provider: string): LlmProxyError => {
  const runError = toRunError(cause);
  switch (runError.code) {
    case "rate_limited":
      return { code: "RATE_LIMITED", data: { retryAfterSeconds: 0 } };
    case "context_too_long":
      return validation([{ message: runError.message, path: ["prompt"] }]);
    default:
      return { code: "PROVIDER_UNAVAILABLE", data: { provider } };
  }
};

/** `auto` through the Decider; anything else as given. */
const routeSelector = async (
  request: LlmProxyRequest,
  deps: LlmProxyDeps,
  signal: AbortSignal | undefined
): Promise<Result<ModelSelector, LlmProxyError>> => {
  if (request.model !== AUTO_MODEL) {
    return ok(request.model);
  }
  const routed = deps.routeAuto
    ? await deps.routeAuto(stateFromPrompt(request.prompt), signal)
    : err({ type: "auto_disabled" as const });
  return routed.ok
    ? ok(routed.value.selector)
    : err(
        validation([
          {
            message: "`auto` routing is off on this instance",
            path: ["model"],
          },
        ])
      );
};

const resolveModel = async (
  request: LlmProxyRequest,
  deps: LlmProxyDeps,
  signal: AbortSignal | undefined
): Promise<Result<ModelRef, LlmProxyError>> => {
  const routed = await routeSelector(request, deps, signal);
  if (!routed.ok) {
    return routed;
  }
  const selector = routed.value;
  const resolved = deps.registry.resolve(selector);
  return resolved.ok
    ? resolved
    : err(
        validation([
          {
            message: `"${selector}" isn't a model on this instance`,
            path: ["model"],
          },
        ])
      );
};

const loadModel = async (
  request: LlmProxyRequest,
  ref: ModelRef,
  deps: LlmProxyDeps
): Promise<
  Result<{ model: LanguageModelV4; source: KeyScope | null }, LlmProxyError>
> => {
  const provider = providerOf(ref);
  const keys = await deps.resolveKeys(request.context);
  if (!keys.ok) {
    return err({ code: "PROVIDER_UNAVAILABLE", data: { provider: null } });
  }
  const credentials = keys.value[provider];
  const model = deps.registry.languageModel(ref, credentials);
  if (!model.ok) {
    return err(
      model.error.type === "missing_key"
        ? { code: "PROVIDER_UNAVAILABLE", data: { provider } }
        : validation([
            { message: `"${ref}" can't take this request`, path: ["model"] },
          ])
    );
  }
  // A ref outside the provider's patterns or catalog is refused (095).
  const offered = await deps.registry.checkModel(ref, credentials);
  if (!offered.ok) {
    return err(
      offered.error.type === "missing_key"
        ? { code: "PROVIDER_UNAVAILABLE", data: { provider } }
        : validation([
            {
              message: `"${ref}" isn't a model on this instance`,
              path: ["model"],
            },
          ])
    );
  }
  return ok({ model: model.value, source: credentials?.source ?? null });
};

const usageOf = (usage: unknown): LlmUsage | null => {
  const parsed = llmUsageSchema.safeParse(toJson(usage));
  return parsed.success ? parsed.data : null;
};

const encoder = new TextEncoder();
const event = (data: unknown) =>
  encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const DONE = encoder.encode("data: [DONE]\n\n");

/** Provider stream parts as SSE, ending `[DONE]`; errors become safe `RunError`s. */
const sseBody = (
  upstream: ReadableStream<LanguageModelV4StreamPart>,
  controller: AbortController,
  finished: (outcome: LlmUsageEvent["outcome"], usage: LlmUsage | null) => void
): ReadableStream<Uint8Array> => {
  const reader = upstream.getReader();
  let usage: LlmUsage | null = null;
  let done = false;
  const finish = (outcome: LlmUsageEvent["outcome"]) => {
    if (!done) {
      done = true;
      finished(outcome, usage);
    }
  };
  const fail = (
    sink: ReadableStreamDefaultController<Uint8Array>,
    cause: unknown
  ) => {
    sink.enqueue(event({ error: toRunError(cause), type: "error" }));
    sink.enqueue(DONE);
    sink.close();
    controller.abort();
    reader.cancel().catch(() => undefined);
    finish("failed");
  };

  return new ReadableStream<Uint8Array>({
    cancel: async () => {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      finish("cancelled");
    },
    pull: async (sink) => {
      try {
        const next = await reader.read();
        if (next.done) {
          sink.enqueue(DONE);
          sink.close();
          finish("completed");
          return;
        }
        const part = next.value;
        switch (part.type) {
          case "raw":
            return;
          case "error":
            fail(sink, part.error);
            return;
          case "finish":
            usage = usageOf(part.usage);
            break;
          default:
            break;
        }
        sink.enqueue(event(toJson(part)));
      } catch (cause) {
        fail(sink, cause);
      }
    },
  });
};

export const handleLlmProxy = async (
  body: unknown,
  deps: LlmProxyDeps,
  { signal }: { readonly signal?: AbortSignal } = {}
): AsyncResult<LlmProxyReply, LlmProxyError> => {
  const parsed = llmProxyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return err({
      code: "BAD_REQUEST",
      data: { issues: issuesOf(parsed.error) },
    });
  }
  const request = parsed.data;
  const prompt = checkPrompt(request.prompt);
  if (!prompt.ok) {
    return err(validation(prompt.error));
  }
  const ref = await resolveModel(request, deps, signal);
  if (!ref.ok) {
    return ref;
  }
  const resolvedModel = ref.value;
  const loaded = await loadModel(request, resolvedModel, deps);
  if (!loaded.ok) {
    return loaded;
  }
  const { model, source } = loaded.value;
  const record = (outcome: LlmUsageEvent["outcome"], usage: LlmUsage | null) =>
    deps.recordUsage({
      context: request.context,
      outcome,
      resolvedModel,
      source,
      usage,
    });

  // Ours, so the stream can stop the provider call when the client goes away.
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort();
  }
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const options: LanguageModelV4CallOptions = {
    abortSignal: controller.signal,
    frequencyPenalty: request.frequencyPenalty,
    maxOutputTokens: request.maxOutputTokens,
    presencePenalty: request.presencePenalty,
    prompt: prompt.value,
    providerOptions: safeProviderOptions(request.providerOptions),
    reasoning: request.reasoning,
    responseFormat:
      request.responseFormat as LanguageModelV4CallOptions["responseFormat"],
    seed: request.seed,
    stopSequences: request.stopSequences,
    temperature: request.temperature,
    toolChoice: request.toolChoice,
    tools: request.tools as LanguageModelV4CallOptions["tools"],
    topK: request.topK,
    topP: request.topP,
  };

  if (request.stream) {
    try {
      const { stream } = await model.doStream(options);
      return ok({
        body: sseBody(stream, controller, record),
        kind: "stream",
        resolvedModel,
      });
    } catch (cause) {
      record(controller.signal.aborted ? "cancelled" : "failed", null);
      return err(callFailed(cause, providerOf(resolvedModel)));
    }
  }

  try {
    const result = await model.doGenerate(options);
    const usage = usageOf(result.usage);
    record("completed", usage);
    const reply = llmProxyResponseSchema.safeParse(
      toJson({
        content: result.content,
        finishReason: result.finishReason,
        providerMetadata: result.providerMetadata,
        resolvedModel,
        response: result.response && {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
        },
        usage: usage ?? { inputTokens: {}, outputTokens: {} },
        warnings: result.warnings,
      })
    );
    return reply.success
      ? ok({ body: reply.data, kind: "json", resolvedModel })
      : err({
          code: "PROVIDER_UNAVAILABLE",
          data: { provider: providerOf(resolvedModel) },
        });
  } catch (cause) {
    record(controller.signal.aborted ? "cancelled" : "failed", null);
    return err(callFailed(cause, providerOf(resolvedModel)));
  }
};

/** The HTTP response for a handler result (the route adds nothing but auth). */
export const llmProxyResponse = (
  result: Result<LlmProxyReply, LlmProxyError>
): Response => {
  if (!result.ok) {
    return llmProxyErrorResponse(result.error);
  }
  const reply = result.value;
  const headers = { "x-resolved-model": reply.resolvedModel };
  if (reply.kind === "json") {
    return Response.json(reply.body, { headers });
  }
  return new Response(reply.body, {
    headers: {
      ...headers,
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      // Proxies must not buffer the stream (docs/decisions/0004).
      "x-accel-buffering": "no",
    },
  });
};
