import type { EvalModelTarget } from "@workspace/ai/evals/model";

import type { Suite } from "./suite";

// Live mode's plan, before anything is called: which provider and model the
// run will call, how many cases, and roughly how many tokens. Pure; the CLI
// prints it and asks for `--yes` (or a yes at the prompt) before booting.
//
// The token figures are rough on purpose. Each model call carries the
// app's instructions and every tool's definition, which dominate a short
// chat; the constants below say what is assumed. There's no cost figure:
// the price table (`models.prices`) is ticket 086, not on this branch.

/** Tokens in one call to the model under test (instructions and tool definitions included). */
export const MODEL_INPUT_TOKENS = 5000;
export const MODEL_OUTPUT_TOKENS = 500;
/** The title job, once per chat, on the same model. */
export const TITLE_INPUT_TOKENS = 300;
export const TITLE_OUTPUT_TOKENS = 20;
/** One judged check: the rubric, the transcript and the verdict. */
export const JUDGE_INPUT_TOKENS = 2000;
export const JUDGE_OUTPUT_TOKENS = 150;

export interface LiveEstimateTotals {
  readonly cases: number;
  readonly judge: {
    readonly calls: number;
    readonly input: number;
    readonly output: number;
  };
  readonly model: {
    readonly calls: number;
    readonly input: number;
    readonly output: number;
  };
  /** Live cases per suite, in order. */
  readonly suites: readonly { readonly cases: number; readonly name: string }[];
}

/** The live cases of `suites` and what they are expected to call. Pure. */
export const estimateLive = (
  suites: readonly Suite[],
  { judged }: { readonly judged: boolean }
): LiveEstimateTotals => {
  const live = suites.flatMap((suite) =>
    suite.cases.flatMap((each) => (each.live ? [each.live] : []))
  );
  const sum = (pick: (each: (typeof live)[number]) => number) =>
    live.reduce((total, each) => total + pick(each), 0);
  const modelCalls = sum((each) => each.modelCalls);
  const chats = sum((each) => each.chats);
  const judgeCalls = judged ? sum((each) => each.judgeCalls) : 0;
  return {
    cases: live.length,
    judge: {
      calls: judgeCalls,
      input: judgeCalls * JUDGE_INPUT_TOKENS,
      output: judgeCalls * JUDGE_OUTPUT_TOKENS,
    },
    model: {
      calls: modelCalls + chats,
      input: modelCalls * MODEL_INPUT_TOKENS + chats * TITLE_INPUT_TOKENS,
      output: modelCalls * MODEL_OUTPUT_TOKENS + chats * TITLE_OUTPUT_TOKENS,
    },
    suites: suites.flatMap((suite) => {
      const cases = suite.cases.filter((each) => each.live).length;
      return cases === 0 ? [] : [{ cases, name: suite.name }];
    }),
  };
};

/** `${NAME}` references in a raw (uninterpolated) config value. Pure. */
export const envReferences = (value: unknown): readonly string[] => {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      for (const match of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (match[1]) {
          found.add(match[1]);
        }
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...found].sort();
};

/** Why live mode won't run in CI, or `null` when it may. Pure. */
export const ciRefusal = (
  env: Readonly<Record<string, string | undefined>>,
  allowCi: boolean
): string | null => {
  const ci = env.CI?.trim().toLowerCase();
  if (!ci || ci === "false" || ci === "0" || allowCi) {
    return null;
  }
  return "Live mode calls real models and may cost money, so it doesn't run in CI (CI is set). Pass --allow-ci as well to run it anyway.";
};

export interface LiveTarget {
  /** Env variables the provider's config names (never their values). */
  readonly env: readonly string[];
  readonly target: EvalModelTarget;
}

const where = ({ target }: LiveTarget): string =>
  target.baseURL === null
    ? `${target.type}, its default endpoint`
    : `${target.type} at ${target.baseURL}`;

const keyOf = (
  { env, target }: LiveTarget,
  isSet: (name: string) => boolean
): string => {
  if (target.keyless) {
    return "no key (a local server)";
  }
  const names =
    env.length === 0
      ? ""
      : ` from ${env.map((name) => `$${name}${isSet(name) ? "" : " (not set)"}`).join(", ")}`;
  return target.hasKey ? `key${names}` : `NO KEY${names}`;
};

const describeTarget = (
  each: LiveTarget,
  isSet: (name: string) => boolean
): string =>
  `${each.target.ref}${each.target.selector === each.target.ref ? "" : ` (alias "${each.target.selector}")`}\n${" ".repeat(20)}provider "${each.target.provider}", ${where(each)}; ${keyOf(each, isSet)}`;

const tokens = (count: number): string => count.toLocaleString("en-US");

/** What the run will call, as the CLI prints it before asking. Pure. */
export const preflight = ({
  configPath,
  estimate,
  isSet,
  judge,
  model,
}: {
  readonly configPath: string;
  readonly estimate: LiveEstimateTotals;
  /** Whether an env variable is set; its value is never read here. */
  readonly isSet: (name: string) => boolean;
  readonly judge: LiveTarget | null;
  readonly model: LiveTarget;
}): string =>
  [
    "Live evals call real models, and may cost money.",
    "",
    `  Config            ${configPath}`,
    `  Model under test  ${describeTarget(model, isSet)}`,
    `  Judge             ${judge ? describeTarget(judge, isSet) : "none: judged checks will be skipped (pass --judge <alias>)"}`,
    `  Cases             ${estimate.cases} live cases (${estimate.suites.map((suite) => `${suite.name} ${suite.cases}`).join(", ")})`,
    `  Model calls       about ${estimate.model.calls}: ~${tokens(estimate.model.input)} input + ~${tokens(estimate.model.output)} output tokens`,
    `  Judge calls       ${judge ? `about ${estimate.judge.calls}: ~${tokens(estimate.judge.input)} input + ~${tokens(estimate.judge.output)} output tokens` : "none"}`,
    "  Cost              not estimated: there's no price table on this branch (models.prices, ticket 086)",
    "",
    `  Rough: assumes ~${tokens(MODEL_INPUT_TOKENS)} input tokens a model call (instructions and tool definitions),`,
    "  and a model that stops where the case expects. Embeddings and web search use local stand-ins.",
  ].join("\n");

/** Why the targets can't run, before anything is called; empty when they can. Pure. */
export const blockers = (
  targets: readonly LiveTarget[],
  estimate: LiveEstimateTotals
): readonly string[] => [
  ...targets.flatMap(({ env, target }) =>
    target.keyless || target.hasKey
      ? []
      : [
          `provider "${target.provider}" has no key${env.length > 0 ? ` (set ${env.map((name) => `$${name}`).join(", ")}; under turbo it must also be passed through to the evals task)` : " in the config"}`,
        ]
  ),
  ...(estimate.cases === 0 ? ["no live cases to run (check --suite)"] : []),
];
