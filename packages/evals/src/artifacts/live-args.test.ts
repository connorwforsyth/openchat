import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_TRIALS, parseLiveArgs, planText } from "./live-args";

const NEEDS_MODEL = /--model/;

const parse = (args: string) => parseLiveArgs(args.split(" ").filter(Boolean));

describe("parseLiveArgs", () => {
  it("refuses to run without a model, so the instance default never runs by accident", () => {
    const parsed = parse("--kind svg --limit 2 --yes");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(NEEDS_MODEL);
  });

  it("caps a run at the default trial limit unless it's raised", () => {
    const all = parse("--model fast --yes");
    expect(!all.ok && all.error).toBe(
      `120 trials is over the cap of ${DEFAULT_MAX_TRIALS}. Narrow it with --kind, --prompt or --limit, or raise it with --max-trials 120.`
    );
    expect(parse("--model fast --yes --max-trials 120").ok).toBe(true);
  });

  it("runs a small, named plan", () => {
    const parsed = parse(
      "--model anthropic:claude-haiku-5-5 --kind svg --kind site --limit 3 --yes"
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.plan.map((each) => each.prompts.length)).toEqual([
        3, 3,
      ]);
      expect(planText(parsed.value)).toBe(
        "Live artifact eval against http://localhost:3101 on anthropic:claude-haiku-5-5: 6 trials of at most 20 (svg 3, site 3)."
      );
    }
  });

  it("prints a dry run's plan without a model", () => {
    const parsed = parse("--kind svg");
    expect(parsed.ok && planText(parsed.value)).toBe(
      "Live artifact eval against http://localhost:3101 on no model yet (--model is required to run): 10 trials of at most 20 (svg 10)."
    );
  });

  it("refuses unknown kinds, options and bad numbers", () => {
    expect(parse("--kind slides").ok).toBe(false);
    expect(parse("--modle fast").ok).toBe(false);
    expect(parse("--max-trials 0").ok).toBe(false);
  });
});
