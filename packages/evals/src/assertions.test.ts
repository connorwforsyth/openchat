import { ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { createAssertions, type ObservedToolCall } from "./assertions";
import type { Judge } from "./judge";

const HTML = /\.html$/;
const RUN_ID = /^run-\d$/;

const write: ObservedToolCall = {
  approval: "approve",
  input: { content: "<h1>Hi</h1>", path: "index.html" },
  name: "write",
  output: { status: "changed" },
  result: "success",
  runId: "run-1",
  toolCallId: "call-1",
};

const setup = (calls: readonly ObservedToolCall[] = [write], judge?: Judge) =>
  createAssertions({
    calls: () => calls,
    ...(judge ? { judge } : {}),
    transcript: () => [],
  });

describe("calledTool", () => {
  it("passes when the tool was called with matching arguments", async () => {
    const { assertions, log } = setup();
    assertions.calledTool("write").gate();
    assertions.calledTool("write", { path: HTML }).gate();
    expect((await log.results()).map((each) => each.outcome)).toEqual([
      "passed",
      "passed",
    ]);
  });

  it("fails, and says what was called, when the tool or its arguments differ", async () => {
    const { assertions, log } = setup();
    assertions.calledTool("bash").gate();
    assertions.calledTool("write", { path: "other.html" }).soft();
    const [missing, wrongArgs] = await log.results();
    expect(missing).toMatchObject({
      message: "called: write",
      outcome: "failed",
      severity: "gate",
    });
    expect(wrongArgs?.outcome).toBe("failed");
    expect(wrongArgs?.severity).toBe("soft");
    expect(wrongArgs?.message).toContain("index.html");
  });

  it("can look at one turn only", async () => {
    const { assertions, log } = setup();
    assertions.calledTool("write", undefined, { in: { toolCalls: [] } }).gate();
    assertions.notCalledTool("write", { in: { toolCalls: [] } }).gate();
    expect((await log.results()).map((each) => each.outcome)).toEqual([
      "failed",
      "passed",
    ]);
  });
});

describe("notCalledTool", () => {
  it("is about one tool, or about any tool", async () => {
    const { assertions, log } = setup();
    assertions.notCalledTool("bash").gate();
    assertions.notCalledTool("write").gate();
    assertions.notCalledTool().gate();
    expect((await log.results()).map((each) => each.outcome)).toEqual([
      "passed",
      "failed",
      "failed",
    ]);
  });
});

describe("check", () => {
  it("includes, equals and matches, and their opposites", async () => {
    const { assertions, log } = setup();
    assertions.check("Echo: hello").includes("hello").gate();
    assertions.check(["a", "b"]).includes("b").gate();
    assertions
      .check({ a: [1, { b: 2 }] })
      .equals({ a: [1, { b: 2 }] })
      .gate();
    assertions.check("run-7").matches(RUN_ID).gate();
    assertions.check({ a: 1, b: 2 }).matches({ a: 1 }).gate();
    assertions.check("Echo: hello").not.includes("goodbye").gate();
    assertions.check(404).not.equals(200).gate();
    const results = await log.results();
    expect(results.map((each) => each.outcome)).toEqual(
      results.map(() => "passed")
    );
  });

  it("fails with what it got", async () => {
    const { assertions, log } = setup();
    assertions.check("Echo: hello", "reply").includes("goodbye").gate();
    assertions.check(200, "status").not.equals(200).gate();
    assertions.check(42, "answer").includes("4").gate();
    const [missing, same, wrongType] = await log.results();
    expect(missing).toMatchObject({
      label: 'reply includes "goodbye"',
      message: 'got "Echo: hello"',
      outcome: "failed",
    });
    expect(same).toMatchObject({
      label: "status does not equal 200",
      outcome: "failed",
    });
    expect(wrongType?.outcome).toBe("failed");
  });
});

describe("judge", () => {
  const verdict = (pass: boolean, reasoning: string) =>
    ok({
      pass,
      reasoning,
      score: pass ? 0.9 : 0.2,
      usage: { inputTokens: 10, outputTokens: 5 },
    });

  it("is skipped, never passed, when no judge is configured", async () => {
    const { assertions, log } = setup();
    assertions.judge("answers helpfully").soft();
    expect(await log.results()).toEqual([
      {
        kind: "judge",
        label: "judge: answers helpfully",
        message:
          "no judge is configured (bun run evals --live --judge <model>)",
        outcome: "skipped",
        severity: "soft",
      },
    ]);
  });

  it("takes the verdict, score and reasoning of the judge it is given", async () => {
    const judge: Judge = {
      judge: ({ criteria }) =>
        Promise.resolve(
          verdict(criteria.includes("polite"), `on "${criteria}"`)
        ),
      name: "fake",
    };
    const { assertions, log } = setup([], judge);
    assertions.judge("is polite").soft();
    assertions.judge("is thorough").soft();
    expect(await log.results()).toMatchObject([
      { message: 'on "is polite"', outcome: "passed", score: 0.9 },
      { message: 'on "is thorough"', outcome: "failed", score: 0.2 },
    ]);
  });

  it("is soft unless the case says gate, and is counted once", async () => {
    const judge: Judge = {
      judge: () => Promise.resolve(verdict(false, "no")),
      name: "fake",
    };
    const { assertions, log } = setup([], judge);
    assertions.judge("left alone");
    const gated = assertions.judge("gated");
    gated.gate();
    gated.soft();
    expect(log.open()).toEqual([]);
    const results = await log.results();
    expect(results.map((result) => [result.label, result.severity])).toEqual([
      ["judge: gated", "gate"],
      ["judge: left alone", "soft"],
    ]);
  });

  it("fails, never passes, when the judge can't decide", async () => {
    const judge: Judge = {
      judge: () =>
        Promise.resolve({
          error: { message: "no verdict within 60 s", type: "timeout" },
          ok: false,
        }),
      name: "fake",
    };
    const { assertions, log } = setup([], judge);
    assertions.judge("is polite");
    expect(await log.results()).toMatchObject([
      {
        message: "the judge failed (timeout): no verdict within 60 s",
        outcome: "failed",
        severity: "soft",
      },
    ]);
  });

  it("hands the judge the transcript so far and the context", async () => {
    const asked: unknown[] = [];
    const judge: Judge = {
      judge: (request) => {
        asked.push(request);
        return Promise.resolve(verdict(true, "ok"));
      },
      name: "fake",
    };
    const { assertions, log } = setup([], judge);
    assertions.judge("sticks to the file", { context: "notes.md: 42" });
    await log.results();
    expect(asked).toMatchObject([
      {
        context: "notes.md: 42",
        criteria: "sticks to the file",
        transcript: [],
      },
    ]);
  });
});

describe("counting", () => {
  it("reports an assertion that was built and never counted", () => {
    const { assertions, log } = setup();
    assertions.calledTool("write");
    assertions.check(1, "one").equals(1).gate();
    expect(log.open()).toEqual(["called write"]);
  });

  it("carries the expected-failure reason", async () => {
    const { assertions, log } = setup();
    assertions
      .notCalledTool("write")
      .gate({ expectedFailure: "floor rules aren't built" });
    expect(await log.results()).toMatchObject([
      { expectedFailure: "floor rules aren't built", outcome: "failed" },
    ]);
  });
});
