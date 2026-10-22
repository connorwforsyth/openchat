import { z } from "zod";

// One live artifact trial, from what the app stored to the verdict, and the
// per-kind summary the report prints. Pure: `live.ts` observes (the run's
// tool calls, the render in a browser) and hands the observation here.
//
// A trial walks one pipeline, and the verdict is the first stage it fell
// out of: the run ended, the model called `create_artifact`, the input
// parsed, the artifact was the kind asked for, the kind's checks passed,
// and the real renderer drew it.

export const failureCategorySchema = z.enum([
  /** The run failed or timed out before saving anything. */
  "run_failed",
  /** The model answered in text and never called an artifact tool. */
  "no_tool_call",
  /** It wrote the work to a workspace file (`write`/`edit`) instead of an artifact. */
  "workspace_file",
  /** It called the tool with input that didn't parse (the call errored). */
  "tool_input_invalid",
  /** It saved an artifact, but not of the kind asked for. */
  "wrong_kind",
  /** The kind's checks refused every attempt; nothing was saved. */
  "schema_invalid",
  /** The tool said it couldn't save (no image model, store down). */
  "unavailable",
  /** Saved, and the renderer reported an error. */
  "render_error",
  /** Saved, and the renderer never said it had drawn it. */
  "render_timeout",
]);
export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const ARTIFACT_TOOLS = ["create_artifact", "generate_image"] as const;
const WORKSPACE_WRITES: readonly string[] = ["write", "edit"];

export const observedCallSchema = z.object({
  input: z.unknown(),
  name: z.string(),
  /** The tool's output value, or its error message when `result` is `error`. */
  output: z.unknown(),
  result: z.enum(["success", "error", "denied", "none"]),
});
export type ObservedCall = z.infer<typeof observedCallSchema>;

export const renderObservationSchema = z.object({
  /** The renderer's error, or the page's alert text. */
  message: z.string().nullable(),
  /** Wall time from opening the artifact's page to the verdict. */
  ms: z.number(),
  screenshot: z.string().nullable(),
  status: z.enum(["rendered", "error", "timeout"]),
});
export type RenderObservation = z.infer<typeof renderObservationSchema>;

export const trialObservationSchema = z.object({
  calls: z.array(observedCallSchema),
  /** Request sent to the first saved artifact of the kind asked for. */
  msToSaved: z.number().nullable(),
  render: renderObservationSchema.nullable(),
  runError: z.string().nullable(),
  /** Request sent to the run settling. */
  runMs: z.number(),
  runStatus: z.string(),
  text: z.string(),
});
export type TrialObservation = z.infer<typeof trialObservationSchema>;

const savedRefSchema = z.object({
  artifact: z.object({ artifactId: z.string(), kind: z.string() }),
  status: z.literal("saved"),
});
const invalidSchema = z.object({
  problems: z.array(z.string()),
  status: z.literal("invalid"),
});
const unavailableSchema = z.object({
  message: z.string(),
  status: z.literal("unavailable"),
});

export interface SavedArtifact {
  readonly artifactId: string;
  readonly kind: string;
}

/** The artifacts a trial's calls saved, in order. Pure. */
export const savedArtifacts = (
  calls: readonly ObservedCall[]
): readonly SavedArtifact[] =>
  calls.flatMap((call) => {
    const saved = savedRefSchema.safeParse(call.output);
    return call.result === "success" && saved.success
      ? [saved.data.artifact]
      : [];
  });

/** The artifact the trial is judged on: the last saved one of `kind`. Pure. */
export const targetArtifact = (
  kind: string,
  calls: readonly ObservedCall[]
): SavedArtifact | null =>
  savedArtifacts(calls).findLast((artifact) => artifact.kind === kind) ?? null;

const isArtifactCall = (call: ObservedCall) =>
  (ARTIFACT_TOOLS as readonly string[]).includes(call.name);

export const verdictSchema = z.object({
  /** Artifact tool calls the model made, retries included. */
  attempts: z.number(),
  category: failureCategorySchema.nullable(),
  /** What went wrong, in the app's or the renderer's words. */
  detail: z.string(),
  /** The kinds it saved, when they weren't the one asked for. */
  savedKinds: z.array(z.string()),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** Where the trial fell out of the pipeline; `category: null` is a pass. Pure. */
export const classifyTrial = (
  kind: string,
  observation: TrialObservation
): Verdict => {
  const calls = observation.calls.filter(isArtifactCall);
  const saved = savedArtifacts(calls);
  const savedKinds = saved.map((artifact) => artifact.kind);
  const base = { attempts: calls.length, savedKinds };
  const verdict = (category: FailureCategory | null, detail: string) => ({
    ...base,
    category,
    detail,
  });

  if (targetArtifact(kind, calls)) {
    const { render } = observation;
    if (render === null || render.status === "timeout") {
      return verdict("render_timeout", render?.message ?? "never rendered");
    }
    return render.status === "error"
      ? verdict("render_error", render.message ?? "")
      : verdict(null, "");
  }
  if (saved.length > 0) {
    return verdict("wrong_kind", `saved ${savedKinds.join(", ")}`);
  }
  const problems = calls.flatMap((call) => {
    const invalid = invalidSchema.safeParse(call.output);
    return invalid.success ? invalid.data.problems : [];
  });
  if (problems.length > 0) {
    return verdict("schema_invalid", problems.join("; "));
  }
  const unavailable = calls
    .map((call) => unavailableSchema.safeParse(call.output))
    .find((parsed) => parsed.success);
  if (unavailable?.success) {
    return verdict("unavailable", unavailable.data.message);
  }
  const errored = calls.find((call) => call.result === "error");
  if (errored) {
    return verdict("tool_input_invalid", String(errored.output));
  }
  if (observation.runStatus !== "succeeded") {
    return verdict(
      "run_failed",
      observation.runError ?? `run ${observation.runStatus}`
    );
  }
  const wrote = observation.calls.find((call) =>
    WORKSPACE_WRITES.includes(call.name)
  );
  if (wrote) {
    const path = (wrote.input as { path?: unknown } | null)?.path;
    return verdict(
      "workspace_file",
      `${wrote.name} ${typeof path === "string" ? path : ""}: ${observation.text.slice(0, 200)}`
    );
  }
  return verdict("no_tool_call", observation.text.slice(0, 300));
};

export const trialSchema = z.object({
  kind: z.string(),
  model: z.string(),
  observation: trialObservationSchema,
  prompt: z.string(),
  promptId: z.string(),
  verdict: verdictSchema,
});
export type Trial = z.infer<typeof trialSchema>;

export interface KindSummary {
  readonly failures: Readonly<Partial<Record<FailureCategory, number>>>;
  readonly kind: string;
  /** Median request-to-rendered time of the rendered trials, in ms. */
  readonly medianMsToRendered: number | null;
  readonly rendered: number;
  /** Trials that saved an artifact of the kind asked for. */
  readonly schemaPassed: number;
  /** Trials whose `create_artifact` input parsed (a call that didn't error). */
  readonly toolParsed: number;
  readonly trials: number;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** Request sent to the artifact drawn on screen; `null` unless it rendered. */
export const msToRendered = (trial: Trial): number | null =>
  trial.verdict.category === null &&
  trial.observation.msToSaved !== null &&
  trial.observation.render
    ? trial.observation.msToSaved + trial.observation.render.ms
    : null;

/** One kind's numbers over its trials. Pure. */
export const summarizeKind = (
  kind: string,
  trials: readonly Trial[]
): KindSummary => {
  const failures: Partial<Record<FailureCategory, number>> = {};
  for (const { verdict } of trials) {
    if (verdict.category) {
      failures[verdict.category] = (failures[verdict.category] ?? 0) + 1;
    }
  }
  return {
    failures,
    kind,
    medianMsToRendered: median(
      trials.flatMap((trial) => {
        const ms = msToRendered(trial);
        return ms === null ? [] : [ms];
      })
    ),
    rendered: trials.filter((trial) => trial.verdict.category === null).length,
    schemaPassed: trials.filter(
      (trial) => targetArtifact(kind, trial.observation.calls) !== null
    ).length,
    toolParsed: trials.filter((trial) =>
      trial.observation.calls.some(
        (call) => isArtifactCall(call) && call.result === "success"
      )
    ).length,
    trials: trials.length,
  };
};

const percent = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;

const seconds = (ms: number | null) =>
  ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`;

const failureText = (summary: KindSummary) =>
  Object.entries(summary.failures)
    .toSorted(([, a], [, b]) => b - a)
    .map(([category, count]) => `${category} ${count}`)
    .join(", ") || "none";

/** The report's table, worst render rate first. Pure. */
export const summaryTable = (summaries: readonly KindSummary[]): string =>
  [
    "| Kind | Trials | Tool parsed | Schema passed | Rendered | Render rate | Median time to render | Failures |",
    "|---|---|---|---|---|---|---|---|",
    ...summaries
      .toSorted(
        (a, b) =>
          a.rendered / Math.max(a.trials, 1) -
            b.rendered / Math.max(b.trials, 1) || a.kind.localeCompare(b.kind)
      )
      .map(
        (summary) =>
          `| ${summary.kind} | ${summary.trials} | ${summary.toolParsed} | ${summary.schemaPassed} | ${summary.rendered} | ${percent(summary.rendered, summary.trials)} | ${seconds(summary.medianMsToRendered)} | ${failureText(summary)} |`
      ),
  ].join("\n");

const cell = (text: string) =>
  text.replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 160);

/** One kind's report: the summary and a row per trial. Pure. */
export const kindReport = (summary: KindSummary, trials: readonly Trial[]) =>
  [
    `# ${summary.kind}`,
    "",
    summaryTable([summary]),
    "",
    "| Prompt | Verdict | Attempts | Saved | Rendered | Detail |",
    "|---|---|---|---|---|---|",
    ...trials.map(
      (trial) =>
        `| ${trial.promptId} | ${trial.verdict.category ?? "rendered"} | ${trial.verdict.attempts} | ${seconds(trial.observation.msToSaved)} | ${seconds(msToRendered(trial))} | ${cell(trial.verdict.detail)} |`
    ),
    "",
  ].join("\n");
