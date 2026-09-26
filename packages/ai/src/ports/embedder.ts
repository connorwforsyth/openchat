import type { ModelRef } from "@workspace/contract/schemas/models";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The Embedder port (PLAN.md §8 RAG): text in, vectors out, for pgvector.
// The adapter wraps the AI SDK's `embedMany` over the model in
// app.config.yaml `embeddings`; changing that model starts a re-index job,
// which is why every vector records the model and dimension it came from.

export interface EmbedResult {
  /** One vector per input, in input order, each `dimensions` long. */
  readonly embeddings: readonly (readonly number[])[];
  readonly usage: { readonly tokens: number };
}

export const embedderErrorSchema = z.discriminatedUnion("type", [
  z.object({ message: z.string(), type: z.literal("unavailable") }),
  z.object({
    retryAfterSeconds: z.number().nullable(),
    type: z.literal("rate_limited"),
  }),
  /** Too many inputs or an input too long for the model; split and retry. */
  z.object({ message: z.string(), type: z.literal("too_large") }),
]);
export type EmbedderError = z.infer<typeof embedderErrorSchema>;

export interface Embedder {
  readonly dimensions: number;
  embed: (
    values: readonly string[],
    options?: { readonly signal?: AbortSignal }
  ) => AsyncResult<EmbedResult, EmbedderError>;
  /** Largest batch one `embed` call accepts. */
  readonly maxBatchSize: number;
  readonly model: ModelRef;
}
