import type { DecisionLogEntry } from "@workspace/contract/schemas/decider";
import { decisionLogEntrySchema } from "@workspace/contract/schemas/decider";
import { newId } from "@workspace/shared/ids";
import {
  Experimental_EvaluationMockModelV4,
  MockLanguageModelV4,
} from "ai/test";
import { describe, expect, it } from "vitest";

import { generated } from "../testing/mock-models";
import {
  createEvaluationDecider,
  createUnavailableDecider,
} from "./evaluation-decider";
import { languageModelEvaluator } from "./language-model-evaluator";

const questions = [
  { id: "needsRetrieval", prompt: "Needs files?", type: "boolean" },
  {
    id: "route",
    options: [{ id: "cheap" }, { description: "hard tasks", id: "strong" }],
    prompt: "Which model?",
    type: "choice",
  },
  {
    id: "risk",
    prompt: "How risky?",
    rubric: "0 harmless, 1 destructive",
    type: "score",
  },
] as const;

const state = {
  facts: { plan: "free" },
  history: [],
  input: "Summarise my PDF",
};
const runId = newId("run");
const clock = () => new Date("2026-09-27T10:00:00.000Z");

const mockEvaluator = (answers: Record<string, unknown>) =>
  new Experimental_EvaluationMockModelV4({
    doEvaluate: () =>
      Promise.resolve({ answers: answers as never, warnings: [] }),
  });

const deciderWith = (
  model: Experimental_EvaluationMockModelV4,
  log: DecisionLogEntry[] = [],
  timeoutMs?: number
) =>
  createEvaluationDecider({
    adapter: "llm-fallback",
    logDecision: (entry) => log.push(entry),
    model,
    modelRef: "ollama:qwen3",
    now: clock,
    timeoutMs,
  });

describe("createEvaluationDecider", () => {
  it("maps evaluation answers to typed answers with probabilities", async () => {
    const model = mockEvaluator({
      needsRetrieval: { probability: 0.2, type: "boolean" },
      risk: { score: 0.25, type: "score" },
      route: {
        choice: "strong",
        probabilities: { cheap: 0.3, strong: 0.7 },
        type: "choice",
      },
    });
    const result = await deciderWith(model).decide(state, questions, {
      purpose: "auto-route",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        needsRetrieval: {
          id: "needsRetrieval",
          probability: 0.8,
          type: "boolean",
          value: false,
        },
        risk: { id: "risk", probability: 1, type: "score", value: 0.25 },
        route: {
          distribution: { cheap: 0.3, strong: 0.7 },
          id: "route",
          probability: 0.7,
          type: "choice",
          value: "strong",
        },
      },
    });
  });

  it("logs every question, answered or not", async () => {
    const log: DecisionLogEntry[] = [];
    const model = mockEvaluator({
      needsRetrieval: { probability: 0.9, type: "boolean" },
      risk: { score: 0, type: "score" },
      route: { choice: "cheap", type: "choice" },
    });
    await deciderWith(model, log).decide(state, questions, {
      context: { runId },
      purpose: "retrieval-gate",
    });
    expect(log).toHaveLength(3);
    for (const entry of log) {
      expect(decisionLogEntrySchema.parse(entry)).toEqual(entry);
    }
    expect(log[0]).toMatchObject({
      adapter: "llm-fallback",
      answer: { value: true },
      error: null,
      model: "ollama:qwen3",
      purpose: "retrieval-gate",
      runId,
    });

    const failed: DecisionLogEntry[] = [];
    await createUnavailableDecider({
      adapter: "rules",
      logDecision: (entry) => failed.push(entry),
      message: "off",
      now: clock,
    }).decide(state, questions, { purpose: "auto-route" });
    expect(failed.map((entry) => [entry.answer, entry.error])).toEqual([
      [null, "unavailable"],
      [null, "unavailable"],
      [null, "unavailable"],
    ]);
  });

  it("calls an answer that doesn't fit invalid output", async () => {
    const model = mockEvaluator({
      needsRetrieval: { probability: 2, type: "boolean" },
      risk: { score: 0, type: "score" },
      route: { choice: "cheap", type: "choice" },
    });
    const result = await deciderWith(model).decide(state, questions, {
      purpose: "intent",
    });
    expect(result).toMatchObject({
      error: { type: "invalid_output" },
      ok: false,
    });
  });

  it("reports a failing model as unavailable without its details", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: () =>
        Promise.reject(new Error("401 from https://provider with sk-live-x")),
    });
    const result = await deciderWith(model).decide(state, questions, {
      purpose: "intent",
    });
    expect(result).toEqual({
      error: {
        message: "the decision model is unavailable",
        type: "unavailable",
      },
      ok: false,
    });
  });

  it("gives up after its timeout", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () =>
            reject(abortSignal.reason)
          );
        }),
    });
    const result = await deciderWith(model, [], 10).decide(state, questions, {
      purpose: "intent",
    });
    expect(result).toEqual({ error: { type: "timeout" }, ok: false });
  });
});

describe("languageModelEvaluator (llm-fallback)", () => {
  it("answers through structured output and normalises distributions", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([
        {
          text: JSON.stringify({
            needsRetrieval: { probability: 0.75 },
            risk: { score: 1 },
            route: { probabilities: { cheap: 1, strong: 3 } },
          }),
          type: "text",
        },
      ]),
    });
    const decider = createEvaluationDecider({
      adapter: "llm-fallback",
      model: languageModelEvaluator(model),
      modelRef: "ollama:qwen3",
    });
    const result = await decider.decide(state, questions, {
      purpose: "auto-route",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        needsRetrieval: { probability: 0.75, value: true },
        risk: { value: 1 },
        route: { distribution: { cheap: 0.25, strong: 0.75 }, value: "strong" },
      },
    });
    const [call] = model.doGenerateCalls;
    expect(call?.temperature).toBe(0);
    expect(call?.responseFormat).toMatchObject({ type: "json" });
    expect(JSON.stringify(call?.prompt)).toContain("Summarise my PDF");
  });

  it("treats unparseable output as invalid", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([{ text: "sure! yes", type: "text" }]),
    });
    const decider = createEvaluationDecider({
      adapter: "llm-fallback",
      model: languageModelEvaluator(model),
      modelRef: null,
    });
    const result = await decider.decide(state, questions, {
      purpose: "auto-route",
    });
    expect(result).toMatchObject({
      error: { type: "invalid_output" },
      ok: false,
    });
  });
});
