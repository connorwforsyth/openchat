import { parseConfig } from "@workspace/config/parse";
import type { AppConfig } from "@workspace/config/schema";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { evalite } from "evalite";

import { type AutoRoute, routeAutoModel } from "../src/decider/auto-route";
import { createEvaluationDecider } from "../src/decider/evaluation-decider";
import { passes } from "./core/scorers";
import {
  RECORDED_PROBABILITIES,
  ROUTING_CASES,
  type Route,
} from "./routing/fixtures";

// Dev eval (D21): the Decider sends `auto` turns to the cheap or strong
// model as a person would, on labelled prompts. The evaluation model is a
// mock replaying recorded answers, so this checks our routing logic, the
// question mapping and the threshold, not a live model.

const SELECTORS: Readonly<Record<Route, string>> = {
  cheap: "eval:cheap",
  strong: "eval:strong",
};

const config = (): Pick<AppConfig, "decider" | "models"> => {
  const parsed = parseConfig("", {});
  if (!parsed.ok) {
    throw new Error("the default config doesn't parse");
  }
  // Set after parsing: the schema checks refs against configured providers.
  return {
    decider: parsed.value.decider,
    models: {
      ...parsed.value.models,
      auto: { cheap: SELECTORS.cheap, enabled: true, strong: SELECTORS.strong },
    },
  };
};

/** Replays the recorded probability for the turn's input. */
const recordedEvaluator = new Experimental_EvaluationMockModelV4({
  doEvaluate: (options) => {
    const { input } = options.state as { readonly input: string };
    const probability = RECORDED_PROBABILITIES[input];
    if (probability === undefined) {
      throw new Error(`no recorded answer for "${input}"`);
    }
    if (probability === null) {
      throw new Error("evaluation model unavailable");
    }
    return Promise.resolve({
      answers: { needsStrongModel: { probability, type: "boolean" } },
      warnings: [],
    });
  },
});

const decider = createEvaluationDecider({
  adapter: "llm-fallback",
  model: recordedEvaluator,
  modelRef: null,
});

evalite<string, AutoRoute, Route>("Decider routes auto turns", {
  data: ROUTING_CASES.map(({ expected, input }) => ({ expected, input })),
  scorers: [
    passes("routes as labelled", (output, expected) =>
      expected && output.selector === SELECTORS[expected]
        ? true
        : `routed to ${output.selector}, wanted ${expected}`
    ),
  ],
  task: async (input) => {
    const routed = await routeAutoModel({
      config: config(),
      decider,
      state: { facts: {}, history: [], input },
    });
    if (!routed.ok) {
      throw new Error("auto routing is off in the eval config");
    }
    return routed.value;
  },
});
