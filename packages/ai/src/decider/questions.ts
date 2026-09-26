import type { Experimental_EvaluationModelV4Question } from "@ai-sdk/provider";
import type { DeciderAnswer } from "@workspace/contract/schemas/decider";

import type { DeciderQuestionInput } from "../ports/decider";

// Our Decider questions and answers (D15) against the AI SDK's evaluation
// spec (`experimental_evaluate`), which the Decider adapters are built on.
// Differences: our score is 0–1 with a rubric (the SDK's is a position on
// ordered levels), and every answer carries a `probability` for its value.

/** Level names for our 0–1 score: the rubric says what the ends mean. */
const SCORE_LEVELS = ["lowest (0)", "highest (1)"] as const;

export const toEvaluationQuestion = (
  question: DeciderQuestionInput
): Experimental_EvaluationModelV4Question => {
  switch (question.type) {
    case "boolean":
      return { instructions: question.prompt, type: "boolean" };
    case "choice":
      return {
        criteria: Object.fromEntries(
          question.options.map((option) => [
            option.id,
            option.description ?? null,
          ])
        ),
        instructions: question.prompt,
        type: "choice",
      };
    case "score":
      return {
        criteria: [...SCORE_LEVELS],
        instructions: question.rubric
          ? { question: question.prompt, rubric: question.rubric }
          : question.prompt,
        type: "score",
      };
    default:
      return question satisfies never;
  }
};

/** An answer as `experimental_evaluate` returns it (already validated there). */
export type EvaluationAnswer =
  | {
      readonly choice: string;
      readonly probabilities?: Record<string, number>;
      readonly type: "choice";
    }
  | {
      readonly probabilities?: Record<string, number>;
      readonly score: number;
      readonly type: "score";
    }
  | { readonly probability: number; readonly type: "boolean" };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Maps one answer back, or `undefined` if it doesn't fit its question. Where
 * the model gave no distribution, confidence is reported as 1: uncalibrated,
 * which is why thresholds live in config (D15).
 */
export const fromEvaluationAnswer = (
  question: DeciderQuestionInput,
  answer: EvaluationAnswer | undefined
): DeciderAnswer | undefined => {
  if (!answer || answer.type !== question.type) {
    return;
  }
  switch (answer.type) {
    case "boolean": {
      const pTrue = clamp01(answer.probability);
      const value = pTrue >= 0.5;
      return {
        id: question.id,
        probability: value ? pTrue : 1 - pTrue,
        type: "boolean",
        value,
      };
    }
    case "choice": {
      if (question.type !== "choice") {
        return;
      }
      const ids = question.options.map((option) => option.id);
      if (!ids.includes(answer.choice)) {
        return;
      }
      const distribution = Object.fromEntries(
        ids.map((id) => [
          id,
          clamp01(answer.probabilities?.[id] ?? (id === answer.choice ? 1 : 0)),
        ])
      );
      return {
        distribution,
        id: question.id,
        probability: distribution[answer.choice] ?? 1,
        type: "choice",
        value: answer.choice,
      };
    }
    case "score":
      return {
        id: question.id,
        probability: 1,
        type: "score",
        value: clamp01(answer.score / (SCORE_LEVELS.length - 1)),
      };
    default:
      return answer satisfies never;
  }
};

/** P(yes) for a boolean answer, whichever way it came out. */
export const probabilityOfTrue = (
  answer: Extract<DeciderAnswer, { type: "boolean" }>
): number => (answer.value ? answer.probability : 1 - answer.probability);
