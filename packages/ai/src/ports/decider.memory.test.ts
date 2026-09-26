import { describe, expect, expectTypeOf, it } from "vitest";

import type { AnswersFor } from "./decider";
import { createFakeDecider, defaultAnswer } from "./decider.memory";

const questions = [
  { id: "needsRetrieval", prompt: "Needs files?", type: "boolean" },
  {
    id: "route",
    options: [{ id: "cheap" }, { id: "strong" }],
    prompt: "Which model?",
    type: "choice",
  },
  { id: "risk", prompt: "How risky?", type: "score" },
] as const;

const state = { facts: {}, history: [], input: "Summarise my PDF" };

describe("fake Decider", () => {
  it("types answers by question id and type", () => {
    type Answers = AnswersFor<typeof questions>;
    expectTypeOf<Answers["needsRetrieval"]["value"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Answers["risk"]["value"]>().toEqualTypeOf<number>();
    expectTypeOf<Answers["route"]["type"]>().toEqualTypeOf<"choice">();
  });

  it("gives strict defaults when not scripted", async () => {
    const result = await createFakeDecider().decide(state, questions, {
      purpose: "auto-route",
    });
    expect(result.ok && result.value.needsRetrieval.value).toBe(false);
    expect(result.ok && result.value.route).toMatchObject({
      distribution: { cheap: 1, strong: 0 },
      value: "cheap",
    });
    expect(result.ok && result.value.risk.value).toBe(0);
  });

  it("uses scripted answers and records calls", async () => {
    const decider = createFakeDecider({
      answer: (question, s) =>
        question.id === "needsRetrieval" && s.input.includes("PDF")
          ? { id: question.id, probability: 0.92, type: "boolean", value: true }
          : undefined,
    });
    const result = await decider.decide(state, questions, {
      purpose: "retrieval-gate",
    });
    expect(result.ok && result.value.needsRetrieval).toEqual({
      id: "needsRetrieval",
      probability: 0.92,
      type: "boolean",
      value: true,
    });
    expect(decider.calls).toHaveLength(1);
    expect(decider.calls[0]?.options.purpose).toBe("retrieval-gate");
  });

  it("rejects an answer that doesn't fit its question", async () => {
    const wrongType = createFakeDecider({
      answer: (q) => ({ id: q.id, probability: 1, type: "score", value: 0.5 }),
    });
    expect(
      (await wrongType.decide(state, [questions[0]], { purpose: "intent" })).ok
    ).toBe(false);
    const badOption = createFakeDecider({
      answer: (q) => ({
        distribution: {},
        id: q.id,
        probability: 1,
        type: "choice",
        value: "huge",
      }),
    });
    expect(
      (await badOption.decide(state, [questions[1]], { purpose: "auto-route" }))
        .ok
    ).toBe(false);
  });

  it("fails every call when told to, so callers can test their fallback", async () => {
    const decider = createFakeDecider({
      error: { message: "no model", type: "unavailable" },
    });
    expect(
      await decider.decide(state, questions, { purpose: "risk-score" })
    ).toEqual({
      error: { message: "no model", type: "unavailable" },
      ok: false,
    });
  });

  it("builds a default answer for each question type", () => {
    expect(questions.map((q) => defaultAnswer(q).type)).toEqual([
      "boolean",
      "choice",
      "score",
    ]);
  });
});
