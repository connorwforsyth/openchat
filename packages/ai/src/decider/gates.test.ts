import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import type { DecisionLogEntry } from "@workspace/contract/schemas/decider";
import { describe, expect, it } from "vitest";
import { createFakeDecider } from "../ports/decider.memory";
import { createMemoryProviderRegistry } from "../ports/provider-registry.memory";
import { buildRegistry } from "../providers/registry";
import { type ApprovalMode, stricter } from "../tools/resolve";
import { routeAutoModel } from "./auto-route";
import { createDecider } from "./from-config";
import { gateRetrieval } from "./retrieval-gate";
import { riskMode, withRisk } from "./risk";

const state = { facts: {}, history: [], input: "What's new in Postgres 18?" };
const config = (input: AppConfigInput = {}) => appConfigSchema.parse(input);

const yesWith = (probability: number) =>
  createFakeDecider({
    answer: (question) =>
      question.type === "boolean"
        ? { id: question.id, probability, type: "boolean", value: true }
        : undefined,
  });

const autoConfig = config({
  models: {
    aliases: { fast: "ollama:qwen3", strong: "ollama:qwen3-large" },
    auto: { cheap: "fast", enabled: true, strong: "strong" },
  },
});

describe("routeAutoModel", () => {
  it.each([
    [0.9, "strong"],
    [0.6, "strong"],
    [0.59, "fast"],
  ])(
    "P(strong)=%s routes to %s at the default 0.6 threshold",
    async (p, selector) => {
      const route = await routeAutoModel({
        config: autoConfig,
        decider: yesWith(p),
        state,
      });
      expect(route).toEqual({
        ok: true,
        value: { probability: p, routedBy: "decider", selector },
      });
    }
  );

  it("goes to the strong model when the Decider has no opinion", async () => {
    const decider = createFakeDecider({
      error: { message: "off", type: "unavailable" },
    });
    expect(
      await routeAutoModel({ config: autoConfig, decider, state })
    ).toEqual({
      ok: true,
      value: { probability: null, routedBy: "fallback", selector: "strong" },
    });
  });

  it("refuses when auto isn't enabled", async () => {
    const decider = createFakeDecider();
    expect(await routeAutoModel({ config: config(), decider, state })).toEqual({
      error: { type: "auto_disabled" },
      ok: false,
    });
    expect(decider.calls).toHaveLength(0);
  });
});

describe("gateRetrieval", () => {
  const allowed = ["web_search", "file_search", "bash"];
  const deciders = {
    failing: createFakeDecider({ error: { type: "timeout" } }),
    no: yesWith(0.1),
    yes: yesWith(0.9),
  };

  // The invariant (D15): whatever the Decider says, the gate only removes.
  it.each(
    (["auto", "on", "off"] as const).flatMap((webSearch) =>
      Object.entries(deciders).flatMap(([name, decider]) =>
        [true, false].map(
          (memory) => [webSearch, name, memory, decider] as const
        )
      )
    )
  )(
    "webSearch=%s, decider=%s, memory=%s never adds a tool",
    async (webSearch, _n, memory, decider) => {
      const gate = await gateRetrieval({
        activeTools: allowed,
        decider,
        memory,
        options: { webSearch },
        state,
        threshold: 0.5,
      });
      expect(gate.activeTools.every((name) => allowed.includes(name))).toBe(
        true
      );
      expect(gate.activeTools).toContain("bash");
      if (webSearch === "off") {
        expect(gate.activeTools).not.toContain("web_search");
        expect(gate.needs.web).toBe(false);
      }
      if (webSearch === "on") {
        expect(gate.activeTools).toContain("web_search");
      }
    }
  );

  it("can't bring back a tool the rules left out", async () => {
    const decider = yesWith(0.9);
    const gate = await gateRetrieval({
      activeTools: ["bash"],
      decider,
      memory: false,
      options: { webSearch: "auto" },
      state,
      threshold: 0.5,
    });
    expect(gate).toEqual({
      activeTools: ["bash"],
      decided: false,
      needs: { files: false, memory: false, web: false },
    });
    expect(decider.calls).toHaveLength(0);
  });

  it("drops what the Decider says isn't needed and keeps the rest", async () => {
    const decider = createFakeDecider({
      answer: (question) => ({
        id: question.id,
        probability: 0.9,
        type: "boolean",
        value: question.id === "needsWeb",
      }),
    });
    const gate = await gateRetrieval({
      activeTools: allowed,
      decider,
      memory: true,
      options: { webSearch: "auto" },
      state,
      threshold: 0.5,
    });
    expect(gate).toEqual({
      activeTools: ["web_search", "bash"],
      decided: true,
      needs: { files: false, memory: false, web: true },
    });
    expect(decider.calls[0]?.options.purpose).toBe("retrieval-gate");
  });

  it("leaves the model to decide when the Decider has no opinion", async () => {
    const gate = await gateRetrieval({
      activeTools: allowed,
      decider: deciders.failing,
      memory: true,
      options: { webSearch: "auto" },
      state,
      threshold: 0.5,
    });
    expect(gate.activeTools).toEqual(allowed);
    expect(gate.decided).toBe(false);
  });
});

describe("risk gating", () => {
  const thresholds = { riskAsk: 0.3, riskBlock: 0.7 };
  const modes: ApprovalMode[] = ["auto", "ask", "deny"];

  it.each([
    [0, "auto"],
    [0.3, "ask"],
    [0.69, "ask"],
    [0.7, "deny"],
  ] as const)("score %s is %s", (score, mode) => {
    expect(riskMode(score, thresholds)).toBe(mode);
  });

  it.each(
    modes.flatMap((rule) =>
      [null, 0, 0.5, 1].map((score) => [rule, score] as const)
    )
  )("rule %s with score %s is never looser than the rule", (rule, score) => {
    const mode = withRisk(rule, score, thresholds);
    expect(stricter(mode, rule)).toBe(mode);
  });
});

describe("createDecider", () => {
  const empty = config();

  it("has no opinion with an empty config, and still logs", async () => {
    const log: DecisionLogEntry[] = [];
    const decider = createDecider(empty, {
      keys: {},
      logDecision: (entry) => log.push(entry),
      registry: buildRegistry(empty),
    });
    const result = await gateRetrieval({
      activeTools: ["web_search"],
      decider,
      memory: false,
      options: { webSearch: "auto" },
      state,
      threshold: 0.5,
    });
    expect(result.decided).toBe(false);
    expect(log.map((entry) => entry.error)).toEqual(["unavailable"]);
  });

  it("builds the llm-fallback Decider on the configured model", () => {
    const registry = createMemoryProviderRegistry({
      keyless: ["ollama"],
      languageModels: {},
    });
    const withModel = config({ decider: { model: "ollama:qwen3" } });
    expect(createDecider(withModel, { keys: {}, registry }).adapter).toBe(
      "llm-fallback"
    );
    expect(
      createDecider(config({ decider: { adapter: "none" } }), {
        keys: {},
        registry,
      }).adapter
    ).toBe("rules");
  });

  it("skips the log when logDecisions is off", async () => {
    const log: DecisionLogEntry[] = [];
    const off = config({ decider: { logDecisions: false } });
    await createDecider(off, {
      keys: {},
      logDecision: (entry) => log.push(entry),
      registry: buildRegistry(off),
    }).decide(state, [{ id: "x", prompt: "?", type: "boolean" }], {
      purpose: "intent",
    });
    expect(log).toEqual([]);
  });
});
