import type { Assertions } from "./assertions";
import type { Harness } from "./harness";

// A suite is a list of cases; a case is a function over `t`, which is the
// harness's actions and the assertions together.

export type EvalContext = Assertions & Harness;

/** What a live case is expected to call, for the pre-flight estimate. */
export interface LiveEstimate {
  /** Chats it starts (each gets a title, one more small model call). */
  readonly chats: number;
  /** Judged checks it makes. */
  readonly judgeCalls: number;
  /** Model calls across its turns (a turn with a tool call is two or more). */
  readonly modelCalls: number;
}

export interface EvalCase {
  /**
   * Set for a case that needs a real model: it runs only under
   * `--live`, and is reported as skipped in a deterministic run.
   */
  readonly live?: LiveEstimate;
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

/**
 * A case for a real model (`bun run evals --live`): plain prompts, soft
 * checks and judged ones. Skipped, with the reason, in a deterministic run,
 * where the mock would only echo it.
 */
export const liveCase = (
  name: string,
  run: (t: EvalContext) => Promise<void>,
  {
    chats = 1,
    judgeCalls = 1,
    modelCalls = 1,
    timeoutMs,
  }: Partial<LiveEstimate> & { readonly timeoutMs?: number } = {}
): EvalCase => ({
  live: { chats, judgeCalls, modelCalls },
  name,
  run,
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
});

/** A case that is owed: reported as skipped with `reason`, never dropped. */
export const todo = (name: string, reason: string): EvalCase => ({
  name,
  todo: reason,
});

export const defineSuite = (suite: Suite): Suite => suite;
