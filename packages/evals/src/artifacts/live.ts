#!/usr/bin/env bun
/**
 * The live artifact eval: sends each kind's prompts (`prompts.ts`) to the
 * running app, through its real artifact path (the system prompt, the kind
 * guides, `create_artifact` and its checks), approves the artifact as a
 * person would, then draws it in the chat's side panel and screenshots it.
 * One trial at a time: a live model is a shared, metered resource.
 *
 *   bun packages/evals/src/artifacts/live.ts --kind presentation --yes
 *     --model <alias or provider:model> [--kind site …] [--limit 10] [--prompt <id> …]
 *     [--max-trials 20]
 *     [--base-url http://localhost:3101] [--out .evals/artifacts-live] [--spend-log <tsv>]
 *
 * `--yes` needs `--model` and at most `--max-trials` trials (20 unless
 * raised); without `--yes` it prints the plan and calls nothing. Writes `<kind>.json`,
 * `<kind>.md`, `summary.json`, `summary.md` and `screenshots/` to `--out`.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ConversationId,
  MessageId,
  RunId,
} from "@workspace/contract/schemas/common";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

import { textOf, toolCallsOf } from "../harness";
import { parseLiveArgs, planText } from "./live-args";
import { ARTIFACT_PROMPTS, type ArtifactPrompt } from "./prompts";
import { createRenderer, type Renderer } from "./render";
import { type LiveSession, signIn } from "./session";
import {
  classifyTrial,
  kindReport,
  summarizeKind,
  summaryTable,
  type Trial,
  type TrialObservation,
  targetArtifact,
  trialSchema,
} from "./trial";

const POLL_MS = 250;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const parsed = parseLiveArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.error}\n`);
  process.exit(2);
}
const options = parsed.value;
const { plan } = options;
process.stdout.write(`${planText(options)}\n`);
if (!(options.yes && options.model)) {
  process.stdout.write("Pass --yes to run it. Nothing was called.\n");
  process.exit(2);
}
const model: string = options.model;

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

const branchOf = async (
  api: LiveSession["api"],
  conversationId: ConversationId,
  leafId: MessageId | null
) =>
  leafId ? (await api.messages.path({ conversationId, leafId })).messages : [];

/** A person's side of a paused run: approve the artifact card, and anything else. */
const approveAll = (
  api: LiveSession["api"],
  runId: RunId,
  approvals: readonly { readonly toolCallId: string }[]
) =>
  api.runs
    .submitApprovals({
      decisions: approvals.map(({ toolCallId }) => ({
        decision: { decision: "approve" as const },
        toolCallId,
      })),
      runId,
    })
    // The run says it waits for a moment after a decision; a repeat is refused.
    .catch(() => undefined);

const runErrorOf = (
  state: { readonly status: string; readonly error?: { message: string } },
  timedOut: boolean
): string | null => {
  if (timedOut) {
    return `timed out after ${options.timeoutS} s`;
  }
  return state.status === "failed" ? (state.error?.message ?? null) : null;
};

/** Sends one prompt in a new chat and follows the run to its end. */
const observe = async (
  { api }: LiveSession,
  kind: ArtifactKind,
  prompt: ArtifactPrompt
): Promise<{
  readonly conversationId: ConversationId;
  readonly observation: Omit<TrialObservation, "render">;
}> => {
  const chat = await api.conversations.create({
    defaultTarget: { model, type: "model" },
    title: `eval: ${prompt.id}`,
  });
  const started = Date.now();
  const { runId } = await api.runs.create({
    conversationId: chat.id,
    input: {
      parentId: null,
      parts: [{ text: prompt.prompt, type: "text" }],
      type: "message",
    },
  });
  const deadline = started + Number(options.timeoutS) * 1000;
  let msToSaved: number | null = null;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling one run.
    const run = await api.runs.get({ id: runId });
    const { state } = run;
    const messages = await branchOf(api, chat.id, run.assistantMessageId);
    const calls = toolCallsOf(messages, runId);
    if (msToSaved === null && targetArtifact(kind, calls)) {
      msToSaved = Date.now() - started;
    }
    if (state.status === "awaiting_approval") {
      await approveAll(api, runId, state.approvals);
    }
    const timedOut = Date.now() > deadline && !TERMINAL.has(state.status);
    if (TERMINAL.has(state.status) || timedOut) {
      if (timedOut) {
        await api.runs.cancel({ id: runId }).catch(() => undefined);
      }
      return {
        conversationId: chat.id,
        observation: {
          calls: calls.map(({ input, name, output, result }) => ({
            input,
            name,
            output,
            result,
          })),
          msToSaved,
          runError: runErrorOf(state, timedOut),
          runMs: Date.now() - started,
          runStatus: timedOut ? "timeout" : state.status,
          text: textOf(messages, runId),
        },
      };
    }
    await sleep(POLL_MS);
  }
};

const titleOf = (
  observation: Omit<TrialObservation, "render">,
  artifactId: string
): string | null => {
  for (const call of observation.calls) {
    const output = call.output as {
      artifact?: { artifactId?: string; title?: string };
    } | null;
    if (output?.artifact?.artifactId === artifactId) {
      return output.artifact.title ?? null;
    }
  }
  return null;
};

const runTrial = async (
  session: LiveSession,
  renderer: Renderer,
  kind: ArtifactKind,
  prompt: ArtifactPrompt,
  shots: string
): Promise<Trial> => {
  const { conversationId, observation } = await observe(session, kind, prompt);
  const target = targetArtifact(kind, observation.calls);
  const title = target ? titleOf(observation, target.artifactId) : null;
  const render =
    target && title
      ? await renderer
          .render({
            conversationId,
            kind,
            screenshot: join(shots, `${prompt.id}.png`),
            title,
          })
          .catch((cause: unknown) => ({
            message: `the harness couldn't open it: ${cause instanceof Error ? cause.message : String(cause)}`,
            ms: 0,
            screenshot: null,
            status: "timeout" as const,
          }))
      : null;
  const full = { ...observation, render };
  return trialSchema.parse({
    kind,
    model,
    observation: full,
    prompt: prompt.prompt,
    promptId: prompt.id,
    verdict: classifyTrial(kind, full),
  });
};

const { out } = options;
const screenshots = join(out, "screenshots");
await mkdir(screenshots, { recursive: true });
const live = await signIn(options.baseUrl);
const browser = await createRenderer({
  baseUrl: options.baseUrl,
  cookie: live.cookie,
});

const readTrials = async (kind: string): Promise<Trial[]> =>
  readFile(join(out, `${kind}.json`), "utf8")
    .then((text) => trialSchema.array().parse(JSON.parse(text)))
    .catch(() => []);

try {
  for (const { kind, prompts } of plan) {
    // A rerun of some prompts replaces only their trials.
    // biome-ignore lint/performance/noAwaitInLoops: kinds run one after another.
    const kept = (await readTrials(kind)).filter(
      (trial) => !prompts.some((each) => each.id === trial.promptId)
    );
    const trials: Trial[] = [];
    for (const prompt of prompts) {
      // biome-ignore lint/performance/noAwaitInLoops: one live call at a time.
      const trial = await runTrial(live, browser, kind, prompt, screenshots);
      trials.push(trial);
      process.stdout.write(
        `${kind}\t${prompt.id}\t${trial.verdict.category ?? "rendered"}\t${(trial.observation.runMs / 1000).toFixed(1)} s\t${trial.verdict.detail.slice(0, 120)}\n`
      );
    }
    const all = [...kept, ...trials].toSorted(
      (a, b) =>
        ARTIFACT_PROMPTS[kind].findIndex((each) => each.id === a.promptId) -
        ARTIFACT_PROMPTS[kind].findIndex((each) => each.id === b.promptId)
    );
    await writeFile(join(out, `${kind}.json`), JSON.stringify(all, null, 2));
    await writeFile(
      join(out, `${kind}.md`),
      kindReport(summarizeKind(kind, all), all)
    );
    // Each step of a run is one model call: a call per tool step, then the answer.
    const modelCalls = trials.reduce(
      (sum, trial) => sum + trial.observation.calls.length + 1,
      0
    );
    if (options.spendLog) {
      await appendFile(
        options.spendLog,
        `${options.spendLane}\t${modelCalls}\tartifact eval: ${kind}, ${trials.length} prompts on ${model}\n`
      );
    }
  }
} finally {
  await browser.close();
}

const summaries = await Promise.all(
  Object.keys(ARTIFACT_PROMPTS).map(async (kind) => {
    const trials = await readTrials(kind);
    return trials.length > 0 ? summarizeKind(kind, trials) : null;
  })
);
const present = summaries.filter((each) => each !== null);
await writeFile(join(out, "summary.json"), JSON.stringify(present, null, 2));
await writeFile(
  join(out, "summary.md"),
  `# Live artifact eval\n\nModel: ${model}\n\n${summaryTable(present)}\n`
);
process.stdout.write(`\n${summaryTable(present)}\n`);
