import type { Judge, JudgedTurn } from "./judge";
import { deepEqual, type Matcher, matches, show } from "./match";
import type { AssertionResult } from "./report";

// The assertions a case makes. Each is built (`t.calledTool("write")`,
// `t.check(reply).includes("Echo")`, `t.judge("…")`) and then counted with
// `.gate()` or `.soft()`; one that is built and never counted is a mistake
// the runner reports, because it would otherwise pass by saying nothing.

/** A tool call as the server stored it, with how it ended. */
export interface ObservedToolCall {
  /** `not-required`, `pending`, or what was decided: `approve`, `reject`, `review`. */
  readonly approval:
    | "not-required"
    | "pending"
    | "approve"
    | "reject"
    | "review";
  readonly input: unknown;
  readonly name: string;
  /** The tool's output, or the error's message, when there is a result. */
  readonly output: unknown;
  /** `none` until a result is stored. */
  readonly result: "success" | "error" | "denied" | "none";
  readonly runId: string;
  readonly toolCallId: string;
}

export interface CountOptions {
  /**
   * The product doesn't do this yet, and why. The check still runs: while
   * it fails the case is an expected failure, and once it passes the case
   * is an unexpected pass, so the marker can't outlive the gap.
   */
  readonly expectedFailure?: string;
}

/** A built assertion, waiting to be counted. */
export interface Verdict {
  /** The run must pass this (`--strict` fails on it). */
  readonly gate: (options?: CountOptions) => void;
  /** Reported, never failing the run. */
  readonly soft: (options?: CountOptions) => void;
}

export interface Check {
  /** Structural equality. */
  readonly equals: (expected: unknown) => Verdict;
  /** A substring of a string, or an element of an array. */
  readonly includes: (expected: unknown) => Verdict;
  /** A regular expression for a string, or any `Matcher`. */
  readonly matches: (pattern: Matcher) => Verdict;
  /** The opposite of whichever comes next. */
  readonly not: Check;
}

/** Narrows a tool assertion to one turn; the whole case otherwise. */
export interface Scope {
  readonly in: { readonly toolCalls: readonly ObservedToolCall[] };
}

export interface Assertions {
  /** The model called `name`, with arguments `args` matches when given. */
  readonly calledTool: (name: string, args?: Matcher, scope?: Scope) => Verdict;
  /** `label` says what the value is, for the report. */
  readonly check: (actual: unknown, label?: string) => Check;
  /**
   * A model-judged check, soft unless `.gate()` says otherwise; skipped when
   * no judge is configured. `context` is the material the answer should
   * rest on (a file the case wrote), which the transcript doesn't show.
   */
  readonly judge: (
    criteria: string,
    options?: { readonly context?: string }
  ) => Verdict;
  /** The model didn't call `name`, or any tool when `name` is left out. */
  readonly notCalledTool: (name?: string, scope?: Scope) => Verdict;
}

export interface AssertionLog {
  /** Labels of assertions that were built and never counted. */
  readonly open: () => readonly string[];
  /** Every counted assertion, once judged ones have their verdicts. */
  readonly results: () => Promise<readonly AssertionResult[]>;
}

interface Evaluated {
  readonly message?: string;
  readonly outcome: AssertionResult["outcome"];
  readonly score?: number;
}

export interface AssertionSources {
  /** Every tool call the case has seen so far. */
  readonly calls: () => readonly ObservedToolCall[];
  readonly judge?: Judge;
  readonly transcript: () => readonly JudgedTurn[];
}

const pass: Evaluated = { outcome: "passed" };
const fail = (message: string): Evaluated => ({ message, outcome: "failed" });

const names = (calls: readonly ObservedToolCall[]): string =>
  calls.length === 0
    ? "no tools were called"
    : `called: ${calls.map((call) => call.name).join(", ")}`;

const includes = (actual: unknown, expected: unknown): boolean | null => {
  if (typeof actual === "string") {
    return typeof expected === "string" && actual.includes(expected);
  }
  if (Array.isArray(actual)) {
    return actual.some((each) => deepEqual(each, expected));
  }
  return null;
};

export const createAssertions = (
  sources: AssertionSources
): { readonly assertions: Assertions; readonly log: AssertionLog } => {
  const counted: Promise<AssertionResult>[] = [];
  const open = new Set<string>();
  /** Judged checks the case didn't count: they count as soft. */
  const uncounted: (() => void)[] = [];

  const verdict = (
    kind: AssertionResult["kind"],
    label: string,
    evaluate: () => Evaluated | Promise<Evaluated>
  ): Verdict => {
    open.add(label);
    const count =
      (severity: AssertionResult["severity"]) =>
      (options: CountOptions = {}) => {
        open.delete(label);
        // Evaluated now, against what the case has seen up to this line.
        const evaluated = Promise.resolve()
          .then(evaluate)
          .catch(
            (cause: unknown): Evaluated =>
              fail(cause instanceof Error ? cause.message : String(cause))
          );
        counted.push(
          evaluated.then((result) => ({
            ...(options.expectedFailure === undefined
              ? {}
              : { expectedFailure: options.expectedFailure }),
            kind,
            label,
            ...(result.message === undefined
              ? {}
              : { message: result.message }),
            outcome: result.outcome,
            ...(result.score === undefined ? {} : { score: result.score }),
            severity,
          }))
        );
      };
    return { gate: count("gate"), soft: count("soft") };
  };

  const check = (actual: unknown, label: string, negated: boolean): Check => {
    const build = (
      verb: string,
      expected: unknown,
      test: () => boolean | null
    ): Verdict => {
      const phrase = `${label} ${negated ? "does not " : ""}${verb} ${show(expected)}`;
      return verdict("check", phrase, () => {
        const held = test();
        if (held === null) {
          return fail(`can't apply "${verb}" to ${show(actual)}`);
        }
        return held === negated ? fail(`got ${show(actual)}`) : pass;
      });
    };
    return {
      equals: (expected) =>
        build(negated ? "equal" : "equals", expected, () =>
          deepEqual(actual, expected)
        ),
      includes: (expected) =>
        build(negated ? "include" : "includes", expected, () =>
          includes(actual, expected)
        ),
      matches: (pattern) =>
        build(negated ? "match" : "matches", pattern, () =>
          matches(actual, pattern)
        ),
      get not() {
        return check(actual, label, !negated);
      },
    };
  };

  const assertions: Assertions = {
    calledTool: (name, args, scope) => {
      // Read now: the verdict is about the calls this line could see.
      const calls = scope?.in.toolCalls ?? sources.calls();
      const label =
        args === undefined
          ? `called ${name}`
          : `called ${name} with ${show(args)}`;
      return verdict("calledTool", label, () => {
        const named = calls.filter((call) => call.name === name);
        if (named.length === 0) {
          return fail(names(calls));
        }
        if (args === undefined || named.some((c) => matches(c.input, args))) {
          return pass;
        }
        return fail(
          `called with ${named.map((call) => show(call.input)).join(" and ")}`
        );
      });
    },
    check: (actual, label = "value") => check(actual, label, false),
    judge: (criteria, options = {}) => {
      // Read now: the verdict is about the case up to this line.
      const transcript = sources.transcript();
      const label = `judge: ${criteria}`;
      const built = verdict("judge", label, async (): Promise<Evaluated> => {
        const { judge } = sources;
        if (!judge) {
          return {
            message:
              "no judge is configured (bun run evals --live --judge <model>)",
            outcome: "skipped",
          };
        }
        const verdictOf = await judge.judge({
          criteria,
          ...(options.context === undefined
            ? {}
            : { context: options.context }),
          transcript,
        });
        if (!verdictOf.ok) {
          // A judge that couldn't decide never passes a check.
          return fail(
            `the judge failed (${verdictOf.error.type}): ${verdictOf.error.message}`
          );
        }
        const { pass: held, reasoning, score } = verdictOf.value;
        return {
          message: reasoning,
          outcome: held ? "passed" : "failed",
          score,
        };
      });
      // Soft by default: a judged check needs no `.soft()` to be counted.
      open.delete(label);
      let done = false;
      const once =
        (count: Verdict["gate"]): Verdict["gate"] =>
        (countOptions) => {
          if (!done) {
            done = true;
            count(countOptions);
          }
        };
      const counts: Verdict = {
        gate: once(built.gate),
        soft: once(built.soft),
      };
      uncounted.push(() => counts.soft());
      return counts;
    },
    notCalledTool: (name, scope) => {
      const calls = scope?.in.toolCalls ?? sources.calls();
      return verdict(
        "notCalledTool",
        name === undefined ? "called no tools" : `did not call ${name}`,
        () => {
          const offending =
            name === undefined
              ? calls
              : calls.filter((call) => call.name === name);
          return offending.length === 0
            ? pass
            : fail(
                offending
                  .map((call) => `${call.name}(${show(call.input)})`)
                  .join(", ")
              );
        }
      );
    },
  };

  return {
    assertions,
    log: {
      open: () => [...open],
      results: () => {
        for (const count of uncounted.splice(0)) {
          count();
        }
        return Promise.all(counted);
      },
    },
  };
};
