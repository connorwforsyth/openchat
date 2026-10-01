import type { CaseResult, Report } from "./report";

// The report as JUnit XML, for CI's test summaries. JUnit knows passed,
// failed, errored and skipped, so: a gate failure and an unexpected pass are
// failures; an expected failure and a skip are `skipped`, with the reason;
// soft failures ride along in `system-out` on a passing case. Pure.

// Characters XML 1.0 can't carry: C0 controls other than tab, LF and CR.
const isForbidden = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
};

const ENTITIES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

export const escapeXml = (text: string): string =>
  [...text]
    .filter((char) => !isForbidden(char))
    .map((char) => ENTITIES[char] ?? char)
    .join("");

const seconds = (ms: number): string => (ms / 1000).toFixed(3);

const notesOf = (result: CaseResult): string =>
  result.assertions
    .filter((assertion) => assertion.outcome !== "passed")
    .map(
      (assertion) =>
        `${assertion.severity} ${assertion.outcome}: ${assertion.label}${
          assertion.message ? `: ${assertion.message}` : ""
        }`
    )
    .join("\n");

const bodyOf = (result: CaseResult): string => {
  const notes = escapeXml(notesOf(result));
  switch (result.outcome) {
    case "error":
      return `<error message="${escapeXml(result.error ?? "the case asserted nothing")}">${notes}</error>`;
    case "gate-failed":
      return `<failure message="a gate failed">${notes}</failure>`;
    case "unexpected-pass":
      return `<failure message="expected to fail, but passed: remove the marker">${escapeXml(result.reason ?? "")}</failure>`;
    case "expected-failure":
      return `<skipped message="${escapeXml(`expected failure: ${result.reason ?? ""}`)}"/>`;
    case "skipped":
      return `<skipped message="${escapeXml(result.reason ?? "every check was skipped")}"/>`;
    case "soft-failed":
      return `<system-out>${notes}</system-out>`;
    case "passed":
      return "";
    default:
      return result.outcome satisfies never;
  }
};

const FAILURES: readonly CaseResult["outcome"][] = [
  "gate-failed",
  "unexpected-pass",
];
const SKIPS: readonly CaseResult["outcome"][] = ["expected-failure", "skipped"];

const countOf = (
  cases: readonly CaseResult[],
  outcomes: readonly CaseResult["outcome"][]
): number => cases.filter((each) => outcomes.includes(each.outcome)).length;

export const junitOf = (report: Report): string => {
  const suites = report.suites.map((suite) => {
    const cases = suite.cases.map(
      (result) =>
        `    <testcase classname="evals.${escapeXml(suite.name)}" name="${escapeXml(result.name)}" time="${seconds(result.durationMs)}">${bodyOf(result)}</testcase>`
    );
    return [
      `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.cases.length}" failures="${countOf(suite.cases, FAILURES)}" errors="${countOf(suite.cases, ["error"])}" skipped="${countOf(suite.cases, SKIPS)}" time="${seconds(suite.durationMs)}" timestamp="${escapeXml(report.startedAt)}">`,
      ...cases,
      "  </testsuite>",
    ].join("\n");
  });
  const all = report.suites.flatMap((suite) => suite.cases);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="evals" tests="${all.length}" failures="${countOf(all, FAILURES)}" errors="${countOf(all, ["error"])}" skipped="${countOf(all, SKIPS)}" time="${seconds(report.durationMs)}">`,
    ...suites,
    "</testsuites>",
    "",
  ].join("\n");
};
