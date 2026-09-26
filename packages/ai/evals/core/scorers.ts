import type { Evalite } from "evalite";

// Scorers the eval suites share (D21: one core of datasets, runner and
// scorers for dev, agent and production evals). Dev evals are pass/fail on
// recorded fixtures, so most scorers are predicates: 1 when it holds, 0
// when it doesn't, with the reason in the metadata for the report.

export type Check<TOutput, TExpected> = (
  output: TOutput,
  expected: TExpected | undefined
) => true | string;

/** A pass/fail scorer. `check` returns `true`, or why it failed. */
export const passes = <TInput, TOutput, TExpected = TOutput>(
  name: string,
  check: Check<TOutput, TExpected>
): Evalite.ScorerOpts<TInput, TOutput, TExpected> => ({
  name,
  scorer: ({ expected, output }) => {
    const verdict = check(output, expected);
    return verdict === true
      ? { score: 1 }
      : { metadata: { reason: verdict }, score: 0 };
  },
});

/** Deep equality through JSON, which is all fixture data ever is. */
export const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
