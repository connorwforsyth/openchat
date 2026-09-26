import {
  type Experimental_EvaluationModelV4,
  InvalidResponseDataError,
  JSONParseError,
  TypeValidationError,
} from "@ai-sdk/provider";
import type {
  DeciderAnswer,
  DeciderQuestion,
  DeciderState,
  DecisionLogEntry,
  deciderAdapterSchema,
} from "@workspace/contract/schemas/decider";
import type { ModelRef } from "@workspace/contract/schemas/models";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";
import {
  Experimental_EvaluationUnsupportedQuestionTypeError,
  experimental_evaluate,
  NoObjectGeneratedError,
} from "ai";
import type { z } from "zod";

import type {
  AnswersFor,
  DecideOptions,
  Decider,
  DeciderError,
  DeciderQuestionInput,
} from "../ports/decider";
import {
  type EvaluationAnswer,
  fromEvaluationAnswer,
  toEvaluationQuestion,
} from "./questions";

// A Decider over any AI SDK evaluation model (D15). `llm-fallback` hands it a
// language model wrapped by `languageModelEvaluator`; `jev` (opt-in, later)
// hands it a native evaluation model. Every question is logged through
// `logDecision`, answered or not; the database write happens elsewhere.

export type LogDecision = (entry: DecisionLogEntry) => void;

type Adapter = z.infer<typeof deciderAdapterSchema>;

export interface EvaluationDeciderOptions {
  readonly adapter: Adapter;
  readonly logDecision?: LogDecision;
  readonly model: Experimental_EvaluationModelV4;
  /** The configured model, for the log; `null` when it isn't a ref. */
  readonly modelRef: ModelRef | null;
  readonly now?: () => Date;
  /** Decisions sit in front of a user's turn, so they're cut off early. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;

/** A mutable copy, as the log's schema wants. */
const asQuestion = (question: DeciderQuestionInput): DeciderQuestion =>
  (question.type === "choice"
    ? {
        ...question,
        options: question.options.map((option) => ({ ...option })),
      }
    : { ...question }) as DeciderQuestion;

export const createDecisionLogger =
  ({
    adapter,
    logDecision,
    modelRef,
    now,
  }: {
    adapter: Adapter;
    logDecision?: LogDecision;
    modelRef: ModelRef | null;
    now: () => Date;
  }) =>
  (
    questions: readonly DeciderQuestionInput[],
    options: DecideOptions,
    outcome: Result<Readonly<Record<string, DeciderAnswer>>, DeciderError>,
    startedAt: Date
  ): void => {
    if (!logDecision) {
      return;
    }
    const finishedAt = now();
    for (const question of questions) {
      try {
        logDecision({
          adapter,
          answer: outcome.ok ? (outcome.value[question.id] ?? null) : null,
          conversationId: options.context?.conversationId ?? null,
          createdAt: finishedAt.toISOString(),
          error: outcome.ok ? null : outcome.error.type,
          id: newId("decision"),
          latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          model: modelRef,
          purpose: options.purpose,
          question: asQuestion(question),
          runId: options.context?.runId ?? null,
          userId: options.context?.userId ?? null,
        });
      } catch {
        // The audit log must never be the reason a turn fails.
      }
    }
  };

const toDeciderError = (cause: unknown, timedOut: boolean): DeciderError => {
  if (timedOut) {
    return { type: "timeout" };
  }
  if (
    InvalidResponseDataError.isInstance(cause) ||
    NoObjectGeneratedError.isInstance(cause) ||
    TypeValidationError.isInstance(cause) ||
    JSONParseError.isInstance(cause)
  ) {
    return {
      message: "the decision model's answer didn't fit",
      type: "invalid_output",
    };
  }
  if (Experimental_EvaluationUnsupportedQuestionTypeError.isInstance(cause)) {
    return {
      message: "the decision model can't answer this question type",
      type: "unavailable",
    };
  }
  // Provider details stay out: they can carry request bodies.
  return { message: "the decision model is unavailable", type: "unavailable" };
};

export const createEvaluationDecider = ({
  adapter,
  logDecision,
  model,
  modelRef,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: EvaluationDeciderOptions): Decider => {
  const log = createDecisionLogger({ adapter, logDecision, modelRef, now });

  const decide = async (
    state: DeciderState,
    questions: readonly DeciderQuestionInput[],
    options: DecideOptions
  ): Promise<Result<Readonly<Record<string, DeciderAnswer>>, DeciderError>> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      const result = await experimental_evaluate({
        abortSignal,
        maxRetries: 0,
        model,
        questions: Object.fromEntries(
          questions.map((question) => [
            question.id,
            toEvaluationQuestion(question),
          ])
        ),
        state: {
          facts: state.facts,
          history: state.history,
          input: state.input,
        },
      });
      const answers: Record<string, DeciderAnswer> = {};
      for (const question of questions) {
        const answer = fromEvaluationAnswer(
          question,
          (result.answers as Record<string, EvaluationAnswer | undefined>)[
            question.id
          ]
        );
        if (!answer) {
          return err({
            message: `no fitting answer for "${question.id}"`,
            type: "invalid_output",
          });
        }
        answers[question.id] = answer;
      }
      return ok(answers);
    } catch (cause) {
      return err(
        toDeciderError(cause, timeout.aborted && !options.signal?.aborted)
      );
    }
  };

  return {
    adapter,
    decide: async <const Qs extends readonly DeciderQuestionInput[]>(
      state: DeciderState,
      questions: Qs,
      options: DecideOptions
    ) => {
      const startedAt = now();
      const outcome = await decide(state, questions, options);
      log(questions, options, outcome, startedAt);
      // `decide` returned an answer per question, each checked against it.
      return outcome as Result<AnswersFor<Qs>, DeciderError>;
    },
  };
};

/** A Decider that always has no opinion: the Decider is off, or its model is missing. */
export const createUnavailableDecider = ({
  adapter,
  logDecision,
  message,
  now = () => new Date(),
}: {
  readonly adapter: Adapter;
  readonly logDecision?: LogDecision;
  readonly message: string;
  readonly now?: () => Date;
}): Decider => {
  const log = createDecisionLogger({
    adapter,
    logDecision,
    modelRef: null,
    now,
  });
  return {
    adapter,
    decide: <const Qs extends readonly DeciderQuestionInput[]>(
      _state: DeciderState,
      questions: Qs,
      options: DecideOptions
    ) => {
      const startedAt = now();
      const outcome = err({ message, type: "unavailable" as const });
      log(questions, options, outcome, startedAt);
      return Promise.resolve(outcome as Result<AnswersFor<Qs>, DeciderError>);
    },
  };
};
