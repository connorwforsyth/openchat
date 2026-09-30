// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests pass `${ENV}` references through as written.
import type { EvalModelTarget } from "@workspace/ai/evals/model";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { suites } from "../suites";
import {
  blockers,
  ciRefusal,
  envReferences,
  estimateLive,
  type LiveTarget,
  preflight,
} from "./live";
import { liveConfig } from "./live-server";
import { LIVE_ONLY, runCase, suitesFor } from "./runner";
import { defineSuite, evalCase, liveCase } from "./suite";
import type { World } from "./world";

// Live mode's plan, without calling anything: the estimate, the refusals,
// the summary it prints, and the config it would boot the app with.

const example = defineSuite({
  cases: [
    evalCase("deterministic", (t) => {
      t.check(1, "one").equals(1).gate();
      return Promise.resolve();
    }),
    liveCase("live one", async () => undefined),
    liveCase("live two", async () => undefined, {
      chats: 2,
      judgeCalls: 3,
      modelCalls: 4,
    }),
  ],
  name: "example",
  proves: "nothing",
});

const target = (overrides: Partial<EvalModelTarget> = {}): LiveTarget => ({
  env: ["ANTHROPIC_API_KEY"],
  target: {
    baseURL: null,
    hasKey: true,
    keyless: false,
    modelId: "claude-haiku-4-5",
    provider: "anthropic",
    ref: "anthropic:claude-haiku-4-5",
    selector: "fast",
    type: "anthropic",
    ...overrides,
  },
});

describe("estimateLive", () => {
  it("counts only live cases, with titles and judge calls", () => {
    expect(estimateLive([example], { judged: true })).toEqual({
      cases: 2,
      judge: { calls: 4, input: 8000, output: 600 },
      model: { calls: 8, input: 25_900, output: 2560 },
      suites: [{ cases: 2, name: "example" }],
    });
    expect(estimateLive([example], { judged: false }).judge.calls).toBe(0);
  });

  it("finds the J checks in the real suites", () => {
    const estimate = estimateLive(suites, { judged: true });
    expect(estimate.suites.map((suite) => suite.name)).toEqual([
      "baseline",
      "tools",
      "grounding",
      "injection",
    ]);
    expect(estimate.cases).toBe(7);
  });
});

describe("suitesFor and runCase", () => {
  it("runs only live cases in live mode, and skips them otherwise", async () => {
    expect(
      suitesFor([example], "live").flatMap((suite) =>
        suite.cases.map((each) => each.name)
      )
    ).toEqual(["live one", "live two"]);
    expect(suitesFor([example], "deterministic")).toEqual([example]);
    const skipped = await runCase(example.cases[1] as never, {
      strict: true,
      world: {} as World,
    });
    expect(skipped).toMatchObject({ outcome: "skipped", reason: LIVE_ONLY });
  });
});

describe("envReferences", () => {
  it("names the variables a raw config refers to, and nothing else", () => {
    expect(
      envReferences({
        anthropic: { apiKey: "${ANTHROPIC_API_KEY}" },
        local: { baseURL: "${OLLAMA_BASE_URL:-http://localhost:11434/v1}" },
        plain: { apiKey: "not-a-reference" },
      })
    ).toEqual(["ANTHROPIC_API_KEY", "OLLAMA_BASE_URL"]);
  });
});

describe("ciRefusal", () => {
  it("refuses in CI unless --allow-ci is given", () => {
    expect(ciRefusal({ CI: "true" }, false)).toContain("--allow-ci");
    expect(ciRefusal({ CI: "1" }, false)).not.toBeNull();
    expect(ciRefusal({ CI: "true" }, true)).toBeNull();
    expect(ciRefusal({}, false)).toBeNull();
    expect(ciRefusal({ CI: "false" }, false)).toBeNull();
  });
});

describe("preflight", () => {
  it("says what it will call and roughly how much, never a key's value", () => {
    const text = preflight({
      configPath: "/repo/app.config.yaml",
      estimate: estimateLive([example], { judged: true }),
      isSet: () => true,
      judge: target({
        baseURL: "http://127.0.0.1:11434/v1",
        hasKey: false,
        keyless: true,
        provider: "ollama",
        ref: "ollama:qwen3",
        selector: "ollama:qwen3",
        type: "openai-compatible",
      }),
      model: target(),
    });
    expect(text).toContain('anthropic:claude-haiku-4-5 (alias "fast")');
    expect(text).toContain(
      'provider "anthropic", anthropic, its default endpoint; key from $ANTHROPIC_API_KEY'
    );
    expect(text).toContain(
      "openai-compatible at http://127.0.0.1:11434/v1; no key (a local server)"
    );
    expect(text).toContain("2 live cases (example 2)");
    expect(text).toContain("~25,900 input + ~2,560 output tokens");
    expect(text).toContain("Cost              not estimated");
  });

  it("says judged checks will be skipped without a judge", () => {
    const text = preflight({
      configPath: "x",
      estimate: estimateLive([example], { judged: false }),
      isSet: () => false,
      judge: null,
      model: target({ hasKey: false }),
    });
    expect(text).toContain("none: judged checks will be skipped");
    expect(text).toContain("NO KEY from $ANTHROPIC_API_KEY (not set)");
  });
});

describe("blockers", () => {
  it("won't run a keyed provider without its key, or nothing at all", () => {
    const estimate = estimateLive([example], { judged: false });
    expect(blockers([target()], estimate)).toEqual([]);
    expect(blockers([target({ hasKey: false })], estimate)).toEqual([
      'provider "anthropic" has no key (set $ANTHROPIC_API_KEY; under turbo it must also be passed through to the evals task)',
    ]);
    expect(blockers([target()], estimateLive([], { judged: false }))).toEqual([
      "no live cases to run (check --suite)",
    ]);
  });
});

describe("liveConfig", () => {
  it("keeps the person's providers as written, with the model under test as the default", () => {
    const config = parse(
      liveConfig({
        aliases: { fast: "anthropic:claude-haiku-4-5" },
        files: "/tmp/files",
        llm: "http://127.0.0.1:1/v1",
        model: "anthropic:claude-haiku-4-5",
        providers: { anthropic: { apiKey: "${ANTHROPIC_API_KEY}" } },
        search: "http://127.0.0.1:2",
      })
    );
    expect(config.providers.anthropic).toEqual({
      apiKey: "${ANTHROPIC_API_KEY}",
    });
    expect(config.models).toEqual({
      aliases: { fast: "anthropic:claude-haiku-4-5" },
      default: "anthropic:claude-haiku-4-5",
    });
    // Embeddings and search stay on the stand-ins.
    expect(config.embeddings.model).toBe("evals-stand-in:embed");
    expect(config.providers["evals-stand-in"].baseURL).toBe(
      "http://127.0.0.1:1/v1"
    );
    expect(config.decider).toEqual({ adapter: "none" });
  });
});
