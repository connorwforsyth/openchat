import { z } from "zod";

// What a run of the evals produces: the JSON report's shape, and the rules
// that turn a case's assertions into its outcome. Pure.
//
// A gate is a check the run must pass; a soft check is reported and never
// fails the run (model-judged scores are soft by default). An assertion
// marked as an expected failure says the product doesn't do this yet: while
// it fails, the case is an `expected-failure`; once it passes, the case is
// an `unexpected-pass`, which `--strict` fails so the marker gets removed.

export const assertionKindSchema = z.enum([
  "calledTool",
  "notCalledTool",
  "check",
  "judge",
]);

export const assertionResultSchema = z.object({
  /** Why this is expected to fail, when the case says the product doesn't do it yet. */
  expectedFailure: z.string().optional(),
  kind: assertionKindSchema,
  /** What was checked, in words. */
  label: z.string(),
  /** Why it failed or was skipped. */
  message: z.string().optional(),
  outcome: z.enum(["passed", "failed", "skipped"]),
  /** A judged check's score, 0 to 1. */
  score: z.number().min(0).max(1).optional(),
  severity: z.enum(["gate", "soft"]),
});
export type AssertionResult = z.infer<typeof assertionResultSchema>;

export const caseOutcomeSchema = z.enum([
  "passed",
  "gate-failed",
  "soft-failed",
  "expected-failure",
  "unexpected-pass",
  "skipped",
  "error",
]);
export type CaseOutcome = z.infer<typeof caseOutcomeSchema>;

const toolCallSummarySchema = z.object({
  approval: z.string(),
  input: z.unknown(),
  name: z.string(),
  result: z.string(),
});

/** One exchange of a case, for whoever reads the report after a failure. */
export const turnSummarySchema = z.object({
  as: z.string(),
  message: z.string(),
  reply: z.string(),
  runId: z.string(),
  status: z.string(),
  toolCalls: z.array(toolCallSummarySchema),
});
export type TurnSummary = z.infer<typeof turnSummarySchema>;

export const caseResultSchema = z.object({
  assertions: z.array(assertionResultSchema),
  durationMs: z.number(),
  /** What the case threw (a bug in the case or the harness, a timeout). */
  error: z.string().optional(),
  name: z.string(),
  outcome: caseOutcomeSchema,
  /** Why the case wasn't run, or why it is expected to fail. */
  reason: z.string().optional(),
  turns: z.array(turnSummarySchema),
});
export type CaseResult = z.infer<typeof caseResultSchema>;

export const suiteResultSchema = z.object({
  cases: z.array(caseResultSchema),
  durationMs: z.number(),
  name: z.string(),
  /** What this suite's deterministic cases really show. */
  proves: z.string(),
});
export type SuiteResult = z.infer<typeof suiteResultSchema>;

export const totalsSchema = z.object({
  cases: z.int(),
  /** Every counted assertion, across the cases. */
  checks: z.object({ failed: z.int(), passed: z.int(), skipped: z.int() }),
  error: z.int(),
  expectedFailure: z.int(),
  gateFailed: z.int(),
  passed: z.int(),
  skipped: z.int(),
  softFailed: z.int(),
  unexpectedPass: z.int(),
});
export type Totals = z.infer<typeof totalsSchema>;

export const reportSchema = z.object({
  durationMs: z.number(),
  finishedAt: z.iso.datetime(),
  /** The judge's name, or `null` when judged checks were skipped. */
  judge: z.string().nullable(),
  /** `deterministic` (the mock model) or `live` (a real one; only live cases). */
  mode: z.enum(["deterministic", "live"]),
  /** The model under test in a live run; `null` for the mock. */
  model: z.string().nullable(),
  /** Whether the run counts as failed (what the exit code says under `--strict`). */
  ok: z.boolean(),
  startedAt: z.iso.datetime(),
  strict: z.boolean(),
  suites: z.array(suiteResultSchema),
  totals: totalsSchema,
  version: z.literal(1),
});
export type Report = z.infer<typeof reportSchema>;

const failed = (assertion: AssertionResult) => assertion.outcome === "failed";

/**
 * A case's outcome from what it asserted. The worst thing wins: an error,
 * then a gate that failed without being expected to, then an expected
 * failure that still fails (one marked assertion failing is enough: a gap
 * half closed is still a gap), then one whose marked assertions all pass,
 * then a soft failure. A case
 * that asserted nothing proves nothing, so it's an error, and one whose
 * every assertion was skipped is skipped.
 */
export const outcomeOf = (
  assertions: readonly AssertionResult[],
  error: string | undefined
): CaseOutcome => {
  if (error !== undefined || assertions.length === 0) {
    return "error";
  }
  const expected = assertions.filter(
    (assertion) => assertion.expectedFailure !== undefined
  );
  const others = assertions.filter(
    (assertion) => assertion.expectedFailure === undefined
  );
  if (others.some((each) => each.severity === "gate" && failed(each))) {
    return "gate-failed";
  }
  if (expected.some(failed)) {
    return "expected-failure";
  }
  if (expected.some((each) => each.outcome === "passed")) {
    return "unexpected-pass";
  }
  if (others.some((each) => each.severity === "soft" && failed(each))) {
    return "soft-failed";
  }
  return assertions.every((each) => each.outcome === "skipped")
    ? "skipped"
    : "passed";
};

/** The reasons a case's failing assertions were expected to fail, once each. */
export const expectedFailureReasons = (
  assertions: readonly AssertionResult[]
): readonly string[] => [
  ...new Set(
    assertions.flatMap((assertion) =>
      assertion.expectedFailure === undefined ? [] : [assertion.expectedFailure]
    )
  ),
];

const count = (results: readonly CaseResult[], outcome: CaseOutcome): number =>
  results.filter((result) => result.outcome === outcome).length;

export const totalsOf = (suites: readonly SuiteResult[]): Totals => {
  const cases = suites.flatMap((suite) => suite.cases);
  const checks = cases.flatMap((result) => result.assertions);
  const checked = (outcome: AssertionResult["outcome"]) =>
    checks.filter((each) => each.outcome === outcome).length;
  return {
    cases: cases.length,
    checks: {
      failed: checked("failed"),
      passed: checked("passed"),
      skipped: checked("skipped"),
    },
    error: count(cases, "error"),
    expectedFailure: count(cases, "expected-failure"),
    gateFailed: count(cases, "gate-failed"),
    passed: count(cases, "passed"),
    skipped: count(cases, "skipped"),
    softFailed: count(cases, "soft-failed"),
    unexpectedPass: count(cases, "unexpected-pass"),
  };
};

/**
 * Whether the run holds: no gate failed, no case broke, and no expected
 * failure passed unnoticed. Soft failures, expected failures and skips
 * don't count against it.
 */
export const holds = (totals: Totals): boolean =>
  totals.gateFailed === 0 && totals.error === 0 && totals.unexpectedPass === 0;

type Counted = Exclude<keyof Totals, "cases" | "checks">;

const LABELS: readonly (readonly [Counted, string])[] = [
  ["passed", "passed"],
  ["gateFailed", "gate-failed"],
  ["softFailed", "soft-failed"],
  ["expectedFailure", "expected-failure"],
  ["unexpectedPass", "unexpected-pass"],
  ["skipped", "skipped"],
  ["error", "error"],
];

/** `12 passed, 1 expected-failure, …` with the empty counts left out. */
export const totalsLine = (totals: Totals): string =>
  LABELS.flatMap(([key, label]) =>
    totals[key] > 0 || key === "passed" ? [`${totals[key]} ${label}`] : []
  ).join(", ");

const MARKS: Record<CaseOutcome, string> = {
  error: "ERROR",
  "expected-failure": "XFAIL",
  "gate-failed": "FAIL",
  passed: "pass",
  skipped: "SKIP",
  "soft-failed": "soft",
  "unexpected-pass": "XPASS",
};

const caseLines = (result: CaseResult): readonly string[] => {
  const head = `  ${MARKS[result.outcome].padEnd(5)} ${result.name} (${Math.round(result.durationMs)} ms)`;
  const notes = [
    ...(result.error === undefined ? [] : [`error: ${result.error}`]),
    ...(result.reason === undefined ? [] : [result.reason]),
    ...result.assertions.flatMap((assertion) => {
      if (assertion.outcome === "passed") {
        return assertion.expectedFailure === undefined
          ? []
          : [`passed, though expected to fail: ${assertion.label}`];
      }
      const why = assertion.message ? `: ${assertion.message}` : "";
      return [
        `${assertion.severity} ${assertion.outcome}: ${assertion.label}${why}`,
      ];
    }),
  ];
  return [head, ...notes.map((note) => `        ${note}`)];
};

/** The run as the terminal shows it: every case, then the counts. */
export const summaryOf = (report: Report): string =>
  [
    ...report.suites.flatMap((suite) => [
      `${suite.name} (${suite.cases.length} cases, ${(suite.durationMs / 1000).toFixed(1)} s)`,
      ...suite.cases.flatMap(caseLines),
    ]),
    "",
    `${report.totals.cases} cases: ${totalsLine(report.totals)} in ${(report.durationMs / 1000).toFixed(1)} s`,
    `${report.totals.checks.passed + report.totals.checks.failed + report.totals.checks.skipped} checks: ${report.totals.checks.passed} passed, ${report.totals.checks.failed} failed, ${report.totals.checks.skipped} skipped`,
    ...(report.model === null ? [] : [`Model: ${report.model}`]),
    report.judge === null
      ? "No judge: judged checks are skipped, never passed (they run with --live --judge <model>)."
      : `Judge: ${report.judge}`,
  ].join("\n");
