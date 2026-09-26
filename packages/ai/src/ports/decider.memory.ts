import {
  type DeciderAnswer,
  type DeciderState,
  deciderAnswerSchema,
} from "@workspace/contract/schemas/decider";
import { err, ok } from "@workspace/shared/result";

import type {
  AnswersFor,
  DecideOptions,
  Decider,
  DeciderError,
  DeciderQuestionInput,
} from "./decider";

// A scripted Decider for tests. `answer` returns an answer per question (or
// `undefined` for the default: `false`, the first option, a score of 0, all
// with probability 1). Answers are checked against their question, so a test
// can't feed the code under test an impossible answer.

export interface DeciderCall {
  readonly options: DecideOptions;
  readonly questions: readonly DeciderQuestionInput[];
  readonly state: DeciderState;
}

export interface FakeDecider extends Decider {
  readonly calls: readonly DeciderCall[];
}

export const defaultAnswer = (
  question: DeciderQuestionInput
): DeciderAnswer => {
  switch (question.type) {
    case "boolean":
      return { id: question.id, probability: 1, type: "boolean", value: false };
    case "choice": {
      const [first] = question.options;
      const value = first?.id ?? "";
      return {
        distribution: Object.fromEntries(
          question.options.map((option) => [
            option.id,
            option.id === value ? 1 : 0,
          ])
        ),
        id: question.id,
        probability: 1,
        type: "choice",
        value,
      };
    }
    case "score":
      return { id: question.id, probability: 1, type: "score", value: 0 };
    default:
      return question satisfies never;
  }
};

const fits = (question: DeciderQuestionInput, answer: DeciderAnswer): boolean =>
  answer.id === question.id &&
  answer.type === question.type &&
  deciderAnswerSchema.safeParse(answer).success &&
  (answer.type !== "choice" ||
    (question.type === "choice" &&
      question.options.some((option) => option.id === answer.value)));

export const createFakeDecider = ({
  answer = () => undefined,
  error,
}: {
  readonly answer?: (
    question: DeciderQuestionInput,
    state: DeciderState
  ) => DeciderAnswer | undefined;
  /** Makes every call fail, to test the callers' fallbacks. */
  readonly error?: DeciderError;
} = {}): FakeDecider => {
  const calls: DeciderCall[] = [];
  return {
    adapter: "rules",
    calls,
    decide: <const Qs extends readonly DeciderQuestionInput[]>(
      state: DeciderState,
      questions: Qs,
      options: DecideOptions
    ) => {
      calls.push({ options, questions, state });
      if (error) {
        return Promise.resolve(err(error));
      }
      const answers: Record<string, DeciderAnswer> = {};
      for (const question of questions) {
        const given = answer(question, state) ?? defaultAnswer(question);
        if (!fits(question, given)) {
          return Promise.resolve(
            err({
              message: `answer doesn't fit question "${question.id}"`,
              type: "invalid_output" as const,
            })
          );
        }
        answers[question.id] = given;
      }
      // Each answer was checked against its question above, which is what
      // the mapped type promises.
      return Promise.resolve(ok(answers as AnswersFor<Qs>));
    },
  };
};
