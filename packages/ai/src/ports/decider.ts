import type {
  ConversationId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  DeciderAnswer,
  DeciderPurpose,
  DeciderQuestion,
  DeciderState,
  deciderAdapterSchema,
} from "@workspace/contract/schemas/decider";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The Decider port (D15): `decide(state, questions)` returns a typed answer
// with a probability for each question. Adapters: `llm-fallback` (default,
// `generateObject` on a small model) and `jev` (opt-in). Callers treat an
// error as "no opinion" and fall back to their strict default: the Decider can
// only make a permission path stricter, never looser.

/**
 * A question as callers write it, usually `as const` so ids stay literal.
 * The same shape as `DeciderQuestion`, with readonly arrays.
 */
export type DeciderQuestionInput = DeciderQuestion extends infer Q
  ? Q extends DeciderQuestion
    ? {
        readonly [K in keyof Q]: Q[K] extends (infer E)[] ? readonly E[] : Q[K];
      }
    : never
  : never;

/** The answer shape for one question: its type, with the question's own id. */
export type AnswerFor<Q extends DeciderQuestionInput> = Extract<
  DeciderAnswer,
  { type: Q["type"] }
> & { readonly id: Q["id"] };

/** Answers keyed by question id: `answers.needsRetrieval.value` is a boolean. */
export type AnswersFor<Qs extends readonly DeciderQuestionInput[]> = {
  readonly [Q in Qs[number] as Q["id"]]: AnswerFor<Q>;
};

export interface DecideOptions {
  /** For `decision_log`. */
  readonly context?: {
    readonly conversationId?: ConversationId;
    readonly runId?: RunId;
    readonly userId?: UserId;
  };
  readonly purpose: DeciderPurpose;
  readonly signal?: AbortSignal;
}

export const deciderErrorSchema = z.discriminatedUnion("type", [
  /** No model configured or reachable (with an empty env, this is the normal case). */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
  z.object({ type: z.literal("timeout") }),
  /** The model answered, but not in the shape asked for. */
  z.object({ message: z.string(), type: z.literal("invalid_output") }),
]);
export type DeciderError = z.infer<typeof deciderErrorSchema>;

export interface Decider {
  readonly adapter: z.infer<typeof deciderAdapterSchema>;
  /** Answers every question or none: a partial answer is an `invalid_output`. */
  decide: <const Qs extends readonly DeciderQuestionInput[]>(
    state: DeciderState,
    questions: Qs,
    options: DecideOptions
  ) => AsyncResult<AnswersFor<Qs>, DeciderError>;
}
