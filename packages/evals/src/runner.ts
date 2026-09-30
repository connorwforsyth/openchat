import { createAssertions } from "./assertions";
import { createHarness } from "./harness";
import type { Judge } from "./judge";
import {
  type CaseResult,
  expectedFailureReasons,
  holds,
  outcomeOf,
  type Report,
  type SuiteResult,
  totalsOf,
} from "./report";
import type { EvalCase, Suite } from "./suite";
import type { World } from "./world";

// Runs the suites against a booted server, one case at a time: the cases
// share one server and its users, so a case that sets a user's memory or
// fills the job queue would otherwise show up in its neighbours.

const CASE_TIMEOUT_MS = 60_000;

export type Mode = "deterministic" | "live";

/** Why a live case isn't run in a deterministic run. */
export const LIVE_ONLY =
  "live only: it needs a real model and a judge (bun run evals --live)";

export interface RunOptions {
  readonly caseTimeoutMs?: number;
  readonly judge?: Judge;
  /** `deterministic` (the default) skips live cases; `live` runs only them. */
  readonly mode?: Mode;
  /** The model under test, for the report (`null` for the mock). */
  readonly model?: string;
  /** Told as each case finishes, for progress output. */
  readonly onCase?: (suite: string, result: CaseResult) => void;
  readonly strict: boolean;
  readonly world: World;
}

const describeError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const timeout = (ms: number): Promise<never> =>
  new Promise((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`the case took longer than ${ms / 1000} s`)),
      ms
    ).unref();
  });

/** The suites a run in `mode` reports: every case, or only the live ones. */
export const suitesFor = (
  suites: readonly Suite[],
  mode: Mode
): readonly Suite[] =>
  mode === "deterministic"
    ? suites
    : suites.flatMap((suite) => {
        const cases = suite.cases.filter((each) => each.live !== undefined);
        return cases.length === 0 ? [] : [{ ...suite, cases }];
      });

export const runCase = async (
  each: EvalCase,
  options: RunOptions
): Promise<CaseResult> => {
  const started = performance.now();
  const { run } = each;
  const liveOnly = each.live !== undefined && options.mode !== "live";
  if (!run || liveOnly) {
    return {
      assertions: [],
      durationMs: 0,
      name: each.name,
      outcome: "skipped",
      reason: liveOnly ? LIVE_ONLY : (each.todo ?? "not written yet"),
      turns: [],
    };
  }
  const { control, harness } = createHarness(options.world);
  const { assertions, log } = createAssertions({
    calls: control.calls,
    ...(options.judge ? { judge: options.judge } : {}),
    transcript: control.transcript,
  });
  let error: string | undefined;
  try {
    await Promise.race([
      run({ ...harness, ...assertions }),
      timeout(each.timeoutMs ?? options.caseTimeoutMs ?? CASE_TIMEOUT_MS),
    ]);
  } catch (cause) {
    error = describeError(cause);
  }
  const results = await log.results();
  const open = log.open();
  if (error === undefined && open.length > 0) {
    // Built and never counted: it would pass by saying nothing.
    error = `assertions without .gate() or .soft(): ${open.join("; ")}`;
  }
  if (error === undefined && results.length === 0) {
    error = "the case asserted nothing";
  }
  const turns = control.summaries();
  await control.cleanup().catch(() => undefined);
  const outcome = outcomeOf(results, error);
  const reasons = expectedFailureReasons(results);
  return {
    assertions: [...results],
    durationMs: performance.now() - started,
    ...(error === undefined ? {} : { error }),
    name: each.name,
    outcome,
    ...(reasons.length > 0 ? { reason: reasons.join(" ") } : {}),
    turns: [...turns],
  };
};

export const runSuites = async (
  suites: readonly Suite[],
  options: RunOptions
): Promise<Report> => {
  const startedAt = new Date();
  const started = performance.now();
  const results: SuiteResult[] = [];
  const mode = options.mode ?? "deterministic";
  for (const suite of suitesFor(suites, mode)) {
    const suiteStarted = performance.now();
    const cases: CaseResult[] = [];
    for (const each of suite.cases) {
      // biome-ignore lint/performance/noAwaitInLoops: one case at a time, on one server.
      const result = await runCase(each, options);
      cases.push(result);
      options.onCase?.(suite.name, result);
    }
    results.push({
      cases,
      durationMs: performance.now() - suiteStarted,
      name: suite.name,
      proves: suite.proves,
    });
  }
  const totals = totalsOf(results);
  return {
    durationMs: performance.now() - started,
    finishedAt: new Date().toISOString(),
    judge: options.judge?.name ?? null,
    mode,
    model: options.model ?? null,
    ok: holds(totals),
    startedAt: startedAt.toISOString(),
    strict: options.strict,
    suites: results,
    totals,
    version: 1,
  };
};
