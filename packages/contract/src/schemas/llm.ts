import { z } from "zod";

import {
  jsonValueSchema,
  providerMetadataSchema,
  timestampSchema,
} from "./common";
import { toolNameSchema } from "./message-parts";
import {
  modelParametersSchema,
  modelRefSchema,
  modelSelectorSchema,
} from "./models";
import { runErrorSchema } from "./runs";
import { chatContextSchema } from "./tenancy";

// The model proxy, `POST /api/llm` (D7): one language-model call made with the
// server's keys for a client that runs its own agent loop (desktop cowork).
// Like the run stream it's plain HTTP, not an oRPC procedure. The body mirrors
// the AI SDK's `LanguageModelV4CallOptions` and the replies mirror
// `LanguageModelV4GenerateResult` and `LanguageModelV4StreamPart`, the same
// wire the SDK's own gateway provider uses, so a client wraps the proxy as a
// custom `LanguageModel` by forwarding its call options with three fields
// added. Prompt content, result content and stream parts stay opaque JSON
// (typed only by `type`) so the contract doesn't pin an AI SDK version.

/** An object with a string `type`; the rest is the AI SDK's and passes through. */
const typedPart = () => z.looseObject({ type: z.string().min(1) });

/**
 * One `LanguageModelV4Message`. Only the role is checked; `content` (a string
 * for `system`, parts otherwise) and `providerOptions` pass through. Binary
 * file data is sent base64-encoded, as the AI SDK gateway does.
 */
export const llmPromptMessageSchema = z.looseObject({
  content: jsonValueSchema,
  role: z.enum(["system", "user", "assistant", "tool"]),
});
export type LlmPromptMessage = z.infer<typeof llmPromptMessageSchema>;

/** A JSON Schema document (draft 7), as the AI SDK passes tool input schemas. */
const jsonSchemaObject = z.record(z.string(), jsonValueSchema);

/**
 * A `LanguageModelV4FunctionTool`: the client executes it. Provider-executed
 * tools aren't accepted: they'd run on the provider with the server's keys,
 * and the server grants those itself (web search, D23).
 */
export const llmFunctionToolSchema = z.object({
  description: z.string().max(10_000).optional(),
  inputExamples: z
    .array(z.object({ input: z.record(z.string(), jsonValueSchema) }))
    .optional(),
  inputSchema: jsonSchemaObject,
  name: toolNameSchema,
  providerOptions: providerMetadataSchema.optional(),
  strict: z.boolean().optional(),
  type: z.literal("function"),
});
export type LlmFunctionTool = z.infer<typeof llmFunctionToolSchema>;

export const llmToolChoiceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auto") }),
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("required") }),
  z.object({ toolName: toolNameSchema, type: z.literal("tool") }),
]);
export type LlmToolChoice = z.infer<typeof llmToolChoiceSchema>;

export const llmResponseFormatSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text") }),
  z.object({
    description: z.string().optional(),
    name: z.string().optional(),
    schema: jsonSchemaObject.optional(),
    type: z.literal("json"),
  }),
]);

/** The AI SDK's `reasoning` call option, passed through as is. */
export const llmReasoningSchema = z.enum([
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

/**
 * The request body. Settings share the bounds presets use (`ModelParameters`),
 * except `reasoning`, which is the SDK's own option rather than our preset
 * effort. Call options the proxy doesn't take (`headers`, `abortSignal`,
 * `includeRawChunks`) are dropped when parsed, so a client can forward its
 * call options whole; aborting the request cancels the provider call.
 */
export const llmProxyRequestSchema = modelParametersSchema
  .omit({ reasoningEffort: true })
  .extend({
    /** Whose keys pay and where usage is recorded (D17); required, never inferred. */
    context: chatContextSchema,
    /** A ref or an alias, resolved as for runs. */
    model: modelSelectorSchema,
    /** Bounded by the server's body limit rather than a count, so long agent loops fit. */
    prompt: z.array(llmPromptMessageSchema).min(1),
    providerOptions: providerMetadataSchema.optional(),
    reasoning: llmReasoningSchema.optional(),
    responseFormat: llmResponseFormatSchema.optional(),
    /** `true` answers `text/event-stream` (stream parts); `false` answers JSON. */
    stream: z.boolean(),
    toolChoice: llmToolChoiceSchema.optional(),
    tools: z.array(llmFunctionToolSchema).max(256).optional(),
  });
export type LlmProxyRequest = z.infer<typeof llmProxyRequestSchema>;

/** A `LanguageModelV4Content` part (text, reasoning, tool-call, file, source, …). */
export const llmContentPartSchema = typedPart();

/** A `LanguageModelV4StreamPart`: one SSE `data:` event of a streamed call. */
export const llmStreamPartSchema = typedPart();
export type LlmStreamPart = z.infer<typeof llmStreamPartSchema>;

/**
 * A failure after the stream has started (a 200 is already sent): the last
 * part before `[DONE]`. `error` is safe to show and never holds a key or a
 * provider response body.
 */
export const llmStreamErrorPartSchema = z.object({
  error: runErrorSchema,
  type: z.literal("error"),
});

/** `LanguageModelV4FinishReason`. */
export const llmFinishReasonSchema = z.object({
  /** The provider's own reason, when it gave one. */
  raw: z.string().optional(),
  unified: z.enum([
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
  ]),
});

const tokenCount = z.int().min(0).optional();

/** `LanguageModelV4Usage`. A count the provider didn't report is absent. */
export const llmUsageSchema = z.object({
  inputTokens: z.object({
    cacheRead: tokenCount,
    cacheWrite: tokenCount,
    noCache: tokenCount,
    total: tokenCount,
  }),
  outputTokens: z.object({
    reasoning: tokenCount,
    text: tokenCount,
    total: tokenCount,
  }),
  raw: z.record(z.string(), jsonValueSchema).optional(),
});
export type LlmUsage = z.infer<typeof llmUsageSchema>;

/** The JSON reply when `stream` is `false`: a `LanguageModelV4GenerateResult`. */
export const llmProxyResponseSchema = z.object({
  content: z.array(llmContentPartSchema),
  finishReason: llmFinishReasonSchema,
  providerMetadata: providerMetadataSchema.optional(),
  /** The concrete model an alias resolved to (also the `x-resolved-model` header). */
  resolvedModel: modelRefSchema,
  response: z
    .object({
      id: z.string().optional(),
      /** The provider's model id, which can be more specific than the ref. */
      modelId: z.string().optional(),
      timestamp: timestampSchema.optional(),
    })
    .optional(),
  usage: llmUsageSchema,
  warnings: z.array(typedPart()),
});
export type LlmProxyResponse = z.infer<typeof llmProxyResponseSchema>;
