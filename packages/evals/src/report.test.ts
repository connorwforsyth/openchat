import { describe, expect, it } from "vitest";

import { escapeXml, junitOf } from "./junit";
import {
  type AssertionResult,
  type CaseResult,
  holds,
  outcomeOf,
  type Report,
  reportSchema,
  summaryOf,
  totalsOf,
} from "./report";

const assertion = (
  outcome: AssertionResult["outcome"],
  extra: Partial<AssertionResult> = {}
): AssertionResult => ({
  kind: "check",
  label: "a check",
  outcome,
  severity: "gate",
  ...extra,
});

const GAP = "the product does not do this yet";

describe("outcomeOf", () => {
  it("passes when every gate passes", () => {
    expect(outcomeOf([assertion("passed")], undefined)).toBe("passed");
  });

  it("is a gate failure when a gate fails, whatever else happened", () => {
    expect(
      outcomeOf(
        [
          assertion("failed"),
          assertion("failed", { expectedFailure: GAP }),
          assertion("failed", { severity: "soft" }),
        ],
        undefined
      )
    ).toBe("gate-failed");
  });

  it("is a soft failure when only soft checks fail", () => {
    expect(
      outcomeOf(
        [assertion("passed"), assertion("failed", { severity: "soft" })],
        undefined
      )
    ).toBe("soft-failed");
  });

  it("is an expected failure while the marked assertion fails", () => {
    expect(
      outcomeOf(
        [assertion("passed"), assertion("failed", { expectedFailure: GAP })],
        undefined
      )
    ).toBe("expected-failure");
  });

  it("is an unexpected pass once the marked assertion passes", () => {
    expect(
      outcomeOf([assertion("passed", { expectedFailure: GAP })], undefined)
    ).toBe("unexpected-pass");
  });

  it("doesn't let an expected failure hide a case that broke", () => {
    expect(
      outcomeOf([assertion("failed", { expectedFailure: GAP })], "boom")
    ).toBe("error");
  });

  it("is skipped, not passed, when every check was skipped", () => {
    expect(
      outcomeOf([assertion("skipped", { severity: "soft" })], undefined)
    ).toBe("skipped");
    expect(
      outcomeOf([assertion("passed"), assertion("skipped")], undefined)
    ).toBe("passed");
  });

  it("is an error when the case asserted nothing", () => {
    expect(outcomeOf([], undefined)).toBe("error");
  });
});

const result = (
  name: string,
  outcome: CaseResult["outcome"],
  extra: Partial<CaseResult> = {}
): CaseResult => ({
  assertions: [],
  durationMs: 12,
  name,
  outcome,
  turns: [],
  ...extra,
});

const report = (cases: readonly CaseResult[]): Report => {
  const suites = [
    { cases: [...cases], durationMs: 40, name: "files", proves: "paths" },
  ];
  const totals = totalsOf(suites);
  return {
    durationMs: 40,
    finishedAt: "2026-10-01T00:00:01.000Z",
    judge: null,
    mode: "deterministic",
    ok: holds(totals),
    startedAt: "2026-10-01T00:00:00.000Z",
    strict: true,
    suites,
    totals,
    version: 1,
  };
};

describe("totals", () => {
  it("counts every outcome, and only gate failures, errors and unexpected passes fail the run", () => {
    const quiet = totalsOf(
      report([
        result("a", "passed"),
        result("b", "soft-failed"),
        result("c", "expected-failure"),
        result("d", "skipped"),
      ]).suites
    );
    expect(quiet).toMatchObject({
      cases: 4,
      expectedFailure: 1,
      passed: 1,
      skipped: 1,
      softFailed: 1,
    });
    expect(holds(quiet)).toBe(true);
    for (const outcome of [
      "gate-failed",
      "error",
      "unexpected-pass",
    ] as const) {
      expect(holds(totalsOf(report([result("x", outcome)]).suites))).toBe(
        false
      );
    }
  });
});

describe("the report", () => {
  const sample = report([
    result("reads inside /work", "passed"),
    result("symlink <escape> & co", "expected-failure", {
      assertions: [
        assertion("failed", { expectedFailure: GAP, label: "read is refused" }),
      ],
      reason: GAP,
    }),
    result("writes", "gate-failed", {
      assertions: [assertion("failed", { label: "wrote", message: "got 1" })],
    }),
    result("judged", "skipped", { reason: "no judge" }),
    result("broke", "error", { error: "timed out" }),
  ]);

  it("matches its schema", () => {
    expect(reportSchema.safeParse(sample).success).toBe(true);
  });

  it("summarises every case and the counts", () => {
    const summary = summaryOf(sample);
    expect(summary).toContain("XFAIL symlink <escape> & co");
    expect(summary).toContain("gate failed: wrote: got 1");
    expect(summary).toContain(
      "5 cases: 1 passed, 1 gate-failed, 1 expected-failure, 1 skipped, 1 error"
    );
  });

  it("writes JUnit with failures, errors and skips told apart", () => {
    const xml = junitOf(sample);
    expect(xml).toContain(
      '<testsuites name="evals" tests="5" failures="1" errors="1" skipped="2"'
    );
    expect(xml).toContain('name="symlink &lt;escape&gt; &amp; co"');
    expect(xml).toContain(`<skipped message="expected failure: ${GAP}"/>`);
    expect(xml).toContain('<failure message="a gate failed">');
    expect(xml).toContain('<error message="timed out">');
  });

  it("an unexpected pass is a JUnit failure", () => {
    const xml = junitOf(report([result("fixed", "unexpected-pass")]));
    expect(xml).toContain("expected to fail, but passed");
    expect(xml).toContain('failures="1"');
  });
});

describe("escapeXml", () => {
  it("escapes markup and drops characters XML can't carry", () => {
    expect(escapeXml('a<b>&"c"\u0000\u0007\n')).toBe(
      "a&lt;b&gt;&amp;&quot;c&quot;\n"
    );
  });
});
