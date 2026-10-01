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
  it("is skipped, never passed, when no judge is configured", async () => {
    const { assertions, log } = setup();
    assertions.judge("answers helpfully").soft();
    expect(await log.results()).toEqual([
      {
        kind: "judge",
        label: "judge: answers helpfully",
        message: "no judge is configured (ticket 085)",
        outcome: "skipped",
        severity: "soft",
      },
    ]);
  });

  it("takes the verdict of the judge it is given", async () => {
    const judge: Judge = {
      judge: ({ criteria }) =>
        Promise.resolve(
          ok({ pass: criteria.includes("polite"), reasoning: "it was curt" })
        ),
      name: "fake",
    };
    const { assertions, log } = setup([], judge);
    assertions.judge("is polite").soft();
    assertions.judge("is thorough").soft();
    expect(await log.results()).toMatchObject([
      { outcome: "passed" },
      { message: "it was curt", outcome: "failed" },
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
