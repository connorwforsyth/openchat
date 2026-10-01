import type { Assertions } from "./assertions";
import type { Harness } from "./harness";

// A suite is a list of cases; a case is a function over `t`, which is the
// harness's actions and the assertions together.

export type EvalContext = Assertions & Harness;

export interface EvalCase {
  readonly name: string;
  /** Left out for a case that can't be written yet; `todo` says why. */
  readonly run?: (t: EvalContext) => Promise<void>;
  /** Longer than the default, for a case that waits on background work. */
  readonly timeoutMs?: number;
  /** Why the case isn't run. It's reported as skipped, with this reason. */
  readonly todo?: string;
}

export interface Suite {
  readonly cases: readonly EvalCase[];
  readonly name: string;
  /**
   * What the suite's deterministic cases really show. The model is a mock
   * that does what each message tells it to, so no case here shows that a
   * model chooses well; this says what the cases are about instead.
   */
  readonly proves: string;
}

export const evalCase = (
  name: string,
  run: (t: EvalContext) => Promise<void>,
  options: { readonly timeoutMs?: number } = {}
): EvalCase => ({ name, run, ...options });

/** A case that is owed: reported as skipped with `reason`, never dropped. */
export const todo = (name: string, reason: string): EvalCase => ({
  name,
  todo: reason,
});

export const defineSuite = (suite: Suite): Suite => suite;
