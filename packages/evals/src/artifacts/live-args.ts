import { parseArgs } from "node:util";

import {
  type ArtifactKind,
  artifactKindSchema,
} from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";

import { ARTIFACT_PROMPTS, type ArtifactPrompt } from "./prompts";

// The live eval's command line, parsed before anything is called. Live
// calls cost money, so a run names its model (the instance default may be a
// paid one) and stays under a trial cap that has to be raised on purpose.

export const DEFAULT_MAX_TRIALS = 20;

export interface LiveOptions {
  readonly baseUrl: string;
  readonly maxTrials: number;
  /** The chats' model; `null` only for a dry run, which calls nothing. */
  readonly model: string | null;
  readonly out: string;
  readonly plan: readonly {
    readonly kind: ArtifactKind;
    readonly prompts: readonly ArtifactPrompt[];
  }[];
  readonly spendLane: string;
  readonly spendLog: string | null;
  readonly timeoutS: number;
  readonly yes: boolean;
}

const positive = (name: string, raw: string): Result<number, string> => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0
    ? ok(value)
    : err(`--${name} must be a whole number above 0, not "${raw}".`);
};

/** The options in `argv`, or why they can't run. Pure. */
export const parseLiveArgs = (
  argv: readonly string[]
): Result<LiveOptions, string> => {
  let parsedArgs: ReturnType<typeof parse>;
  try {
    parsedArgs = parse(argv);
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause));
  }
  const { values } = parsedArgs;
  const kinds: ArtifactKind[] = [];
  for (const raw of values.kind ?? Object.keys(ARTIFACT_PROMPTS)) {
    const kind = artifactKindSchema.safeParse(raw);
    if (!kind.success) {
      return err(`Unknown kind "${raw}".`);
    }
    kinds.push(kind.data);
  }
  const limit = positive("limit", values.limit);
  const maxTrials = positive("max-trials", values["max-trials"]);
  const timeoutS = positive("timeout-s", values["timeout-s"]);
  if (!limit.ok) {
    return limit;
  }
  if (!maxTrials.ok) {
    return maxTrials;
  }
  if (!timeoutS.ok) {
    return timeoutS;
  }
  const plan = kinds.map((kind) => ({
    kind,
    prompts: ARTIFACT_PROMPTS[kind]
      .filter(
        (each) => values.prompt === undefined || values.prompt.includes(each.id)
      )
      .slice(0, limit.value),
  }));
  const model = values.model ?? null;
  if (values.yes && model === null) {
    return err(
      "Pass --model <alias or provider:model> to run: the instance default may be a paid model."
    );
  }
  const trials = plan.reduce((sum, each) => sum + each.prompts.length, 0);
  if (values.yes && trials > maxTrials.value) {
    return err(
      `${trials} trials is over the cap of ${maxTrials.value}. Narrow it with --kind, --prompt or --limit, or raise it with --max-trials ${trials}.`
    );
  }
  return ok({
    baseUrl: values["base-url"],
    maxTrials: maxTrials.value,
    model,
    out: values.out,
    plan,
    spendLane: values["spend-lane"],
    spendLog: values["spend-log"] ?? null,
    timeoutS: timeoutS.value,
    yes: values.yes,
  });
};

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    options: {
      "base-url": { default: "http://localhost:3101", type: "string" },
      kind: { multiple: true, type: "string" },
      limit: { default: "10", type: "string" },
      "max-trials": { default: String(DEFAULT_MAX_TRIALS), type: "string" },
      model: { type: "string" },
      out: { default: ".evals/artifacts-live", type: "string" },
      prompt: { multiple: true, type: "string" },
      "spend-lane": { default: "n2-evals", type: "string" },
      /** A TSV that gets `<lane>\t<model calls>\t<purpose>` per kind. */
      "spend-log": { type: "string" },
      "timeout-s": { default: "240", type: "string" },
      yes: { default: false, type: "boolean" },
    },
    strict: true,
  });

/** What a run will do, printed before anything is called. Pure. */
export const planText = (options: LiveOptions): string => {
  const trials = options.plan.reduce(
    (sum, each) => sum + each.prompts.length,
    0
  );
  const model = options.model ?? "no model yet (--model is required to run)";
  return `Live artifact eval against ${options.baseUrl} on ${model}: ${trials} trials of at most ${options.maxTrials} (${options.plan.map((each) => `${each.kind} ${each.prompts.length}`).join(", ")}).`;
};
