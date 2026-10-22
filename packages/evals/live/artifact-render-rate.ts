#!/usr/bin/env bun
// Render rate per artifact kind, against a running app and a real model.
//
//   bun packages/evals/live/artifact-render-rate.ts \
//     --base http://localhost:3103 --out <dir> [--kinds site,svg] [--n 10]
//
// For each prompt (`artifact-prompts.ts`), one at a time: a new chat, the
// prompt sent with the chat's default model, every approval granted, then
// the saved artifact opened on its own page in a browser and judged
// rendered or not, with a screenshot. Prompts run strictly in sequence: the
// model is one shared local GPU. Sign-in comes from EVAL_EMAIL and
// EVAL_PASSWORD. Nothing here may point at a paid provider: the app's
// config decides the model, so run it only against an instance whose
// default model is local.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { chromium, type Page } from "@playwright/test";
import { createApiClient } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { toolCallsOf } from "../src/harness";
import { ARTIFACT_PROMPTS, type PromptKind } from "./artifact-prompts";

const RUN_TIMEOUT_MS = 240_000;
const POLL_MS = 1000;
const RENDER_WAIT_MS = 15_000;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const { values } = parseArgs({
  options: {
    base: { default: "http://localhost:3103", type: "string" },
    kinds: { type: "string" },
    "max-calls": { default: "40", type: "string" },
    n: { default: "10", type: "string" },
    out: { type: "string" },
    rejudge: { type: "string" },
    sandbox: { default: "off", type: "string" },
  },
});
const { base } = values;
const out = values.out ?? `.context/render-rate/${Date.now()}`;
const perKind = Number(values.n);
/** A hard budget: no prompt starts once the run has made this many calls. */
const maxCalls = Number(values["max-calls"]);
const kinds = (values.kinds?.split(",") ??
  Object.keys(ARTIFACT_PROMPTS)) as PromptKind[];
const sandboxOption = values.sandbox === "auto" ? "auto" : "off";
const email = process.env.EVAL_EMAIL ?? "demo@dots.local";
const password = process.env.EVAL_PASSWORD ?? "";
if (password === "") {
  throw new Error("set EVAL_PASSWORD (and EVAL_EMAIL) to sign in");
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const signIn = async (): Promise<string> => {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin: base },
    method: "POST",
  });
  const cookie = response.headers
    .getSetCookie()
    .map((each) => each.split(";")[0])
    .join("; ");
  if (!(response.ok && cookie)) {
    throw new Error(`sign-in failed: ${response.status}`);
  }
  return cookie;
};

interface Attempt {
  readonly input: unknown;
  readonly output: unknown;
  readonly tool: string;
}

interface Outcome {
  readonly artifactId: string | null;
  readonly attempts: readonly Attempt[];
  readonly conversationId: string;
  readonly createdKind: string | null;
  readonly kind: PromptKind;
  readonly modelCalls: number;
  readonly msToSaved: number | null;
  readonly prompt: string;
  readonly render: RenderVerdict | null;
  readonly runStatus: string;
  readonly text: string;
}

interface RenderVerdict {
  readonly alerts: readonly string[];
  readonly notes: readonly string[];
  readonly rendered: boolean;
  readonly screenshot: string;
}

const cookie = await signIn();
const api = createApiClient({
  baseUrl: base,
  batch: false,
  fetch: globalThis.fetch,
  headers: () => ({ cookie, origin: base }),
});

const savedOf = (output: unknown) =>
  typeof output === "object" &&
  output !== null &&
  "status" in output &&
  output.status === "saved" &&
  "artifact" in output
    ? (output.artifact as { artifactId: string; kind: string })
    : null;

type RunId = Parameters<typeof api.runs.get>[0]["id"];

/** Approves every call the run waits on that wasn't approved already. */
const approvePending = async (
  runId: RunId,
  approvals: readonly { readonly toolCallId: string }[],
  decided: Set<string>
) => {
  const pending = approvals.filter((each) => !decided.has(each.toolCallId));
  if (pending.length === 0) {
    return;
  }
  for (const each of pending) {
    decided.add(each.toolCallId);
  }
  await api.runs.submitApprovals({
    decisions: pending.map(({ toolCallId }) => ({
      decision: { decision: "approve" },
      toolCallId,
    })),
    runId,
  });
};

/** Whether the run has saved an artifact yet. */
const hasSaved = async (
  conversationId: ConversationId,
  runId: RunId,
  leafId: Parameters<typeof api.messages.path>[0]["leafId"]
) => {
  const path = await api.messages.path({ conversationId, leafId });
  return toolCallsOf(path.messages, runId).some(
    (call) => savedOf(call.output) !== null
  );
};

/** Polls the run to its end, approving as it asks, timing the first save. */
const followRun = async (
  conversationId: ConversationId,
  runId: RunId,
  started: number
) => {
  let msToSaved: number | null = null;
  let status = "queued";
  const decided = new Set<string>();
  while (Date.now() - started < RUN_TIMEOUT_MS) {
    // biome-ignore lint/performance/noAwaitInLoops: one run, polled in order.
    const run = await api.runs.get({ id: runId });
    ({ status } = run.state);
    if (
      msToSaved === null &&
      run.assistantMessageId &&
      (await hasSaved(conversationId, runId, run.assistantMessageId))
    ) {
      msToSaved = Date.now() - started;
    }
    if (TERMINAL.has(status)) {
      break;
    }
    if (run.state.status === "awaiting_approval") {
      await approvePending(runId, run.state.approvals, decided);
    }
    await sleep(POLL_MS);
  }
  return { msToSaved, status };
};

const runPrompt = async (
  kind: PromptKind,
  prompt: string
): Promise<Omit<Outcome, "render">> => {
  const chat = await api.conversations.create({});
  const conversationId = chat.id as ConversationId;
  const started = Date.now();
  const created = await api.runs.create({
    conversationId,
    input: {
      parentId: null,
      parts: [{ text: prompt, type: "text" }],
      type: "message",
    },
    // Off by default, as in a Chat-mode turn: the artifact tool, not files.
    options: { sandbox: sandboxOption, webSearch: "off" },
  });
  const { msToSaved, status: settled } = await followRun(
    conversationId,
    created.runId,
    started
  );
  let status = settled;
  if (!TERMINAL.has(status)) {
    await api.runs.cancel({ id: created.runId });
    status = "timed out";
  }
  const run = await api.runs.get({ id: created.runId });
  const path = run.assistantMessageId
    ? await api.messages.path({
        conversationId,
        leafId: run.assistantMessageId,
      })
    : { messages: [] };
  const calls = toolCallsOf(path.messages, created.runId);
  const stream = await fetch(`${base}/api/runs/${created.runId}/stream`, {
    headers: { accept: "text/event-stream", cookie, origin: base },
    signal: AbortSignal.timeout(10_000),
  })
    .then((response) => response.text())
    .catch(() => "");
  // Each step is one model call; the chat's title is one more.
  const modelCalls = (stream.match(/"type":"start-step"/g) ?? []).length + 1;
  const saved = calls.map((call) => savedOf(call.output)).findLast(Boolean);
  const text = path.messages
    .filter((message) => message.runId === created.runId)
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  return {
    artifactId: saved?.artifactId ?? null,
    attempts: calls.map((call) => ({
      input: call.input,
      output: call.output,
      tool: call.name,
    })),
    conversationId,
    createdKind: saved?.kind ?? null,
    kind,
    modelCalls,
    msToSaved,
    prompt,
    runStatus: status,
    text: text.slice(0, 2000),
  };
};

/**
 * What each kind's view draws when it worked, outside any runtime frame;
 * it counts once it's taller than a row or two.
 */
const PANEL_MARKERS: Record<string, string> = {
  code: "main",
  diagram: ".react-flow__node",
  document: ".ProseMirror",
  markdown: "article",
  // Glide's grid, not its section: a grid that collapsed to one row once
  // passed with the section on screen.
  spreadsheet: ".gdg-wmyidgi",
};

/** Whether a frame in the tab (the runtime's) drew more than an empty page. */
const frameDrew = async (tab: Page): Promise<boolean> => {
  const drawn = await Promise.all(
    tab
      .frames()
      .filter((frame) => frame !== tab.mainFrame())
      .map((frame) =>
        frame
          .evaluate(
            () =>
              [...document.querySelectorAll("body *")].filter((element) => {
                const box = element.getBoundingClientRect();
                return box.width > 4 && box.height > 4;
              }).length
          )
          .catch(() => 0)
      )
  );
  return drawn.some((count) => count > 2);
};

const judgeRender = async (
  tab: Page,
  artifactId: string,
  kind: string,
  shot: string
): Promise<RenderVerdict> => {
  await tab.goto(`${base}/artifacts/${artifactId}`, {
    // A dev server compiles the route on its first visit.
    timeout: 180_000,
    waitUntil: "domcontentloaded",
  });
  const notes: string[] = [];
  const marker = PANEL_MARKERS[kind];
  let rendered = false;
  const deadline = Date.now() + RENDER_WAIT_MS;
  while (Date.now() < deadline && !rendered) {
    // biome-ignore lint/performance/noAwaitInLoops: polling the page.
    await sleep(500);
    rendered = marker
      ? ((
          await tab
            .locator(marker)
            .first()
            .boundingBox({ timeout: 500 })
            .catch(() => null)
        )?.height ?? 0) > 60
      : await frameDrew(tab);
  }
  await sleep(1500);
  // Next's route announcer is an empty alert on every page.
  const alerts = (
    await tab
      .locator('[role="alert"]')
      .allInnerTexts()
      .catch(() => [])
  ).filter((each) => each.trim() !== "");
  const statuses = await tab
    .locator('[role="status"]')
    .allInnerTexts()
    .catch(() => []);
  notes.push(...statuses.filter((each) => each.trim() !== ""));
  await tab.screenshot({ path: shot });
  return {
    alerts,
    notes,
    rendered: rendered && alerts.length === 0,
    screenshot: shot,
  };
};

mkdirSync(join(out, "shots"), { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { height: 900, width: 1400 },
});
await context.addCookies(
  cookie.split("; ").map((pair) => {
    const [name = "", ...rest] = pair.split("=");
    return { name, url: base, value: rest.join("=") };
  })
);
const page = await context.newPage();
const outcomes: Outcome[] = [];
const log = join(out, "results.jsonl");
writeFileSync(log, "");

// `--rejudge <results.jsonl>`: render a past run's artifacts again, with no
// model calls, after a change to how they're shown.
const previous: readonly Outcome[] = values.rejudge
  ? readFileSync(values.rejudge, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Outcome)
  : [];

for (const kind of kinds) {
  for (const [index, prompt] of ARTIFACT_PROMPTS[kind]
    .slice(0, perKind)
    .entries()) {
    const before = previous.find(
      (each) => each.kind === kind && each.prompt === prompt
    );
    if (values.rejudge && !before) {
      continue;
    }
    const spent = outcomes.reduce((total, each) => total + each.modelCalls, 0);
    if (spent >= maxCalls) {
      console.log(`stopping: ${spent} model calls reached the cap`);
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose.
    const ran = await (before
      ? Promise.resolve({ ...before, modelCalls: 0 })
      : runPrompt(kind, prompt)
    ).catch(
      (cause: unknown): Omit<Outcome, "render"> => ({
        artifactId: null,
        attempts: [],
        conversationId: "",
        createdKind: null,
        kind,
        modelCalls: 0,
        msToSaved: null,
        prompt,
        runStatus: `error: ${cause instanceof Error ? cause.message : String(cause)}`,
        text: "",
      })
    );
    const render = ran.artifactId
      ? await judgeRender(
          page,
          ran.artifactId,
          ran.createdKind ?? kind,
          join(out, "shots", `${kind}-${index + 1}.png`)
        ).catch((cause: unknown) => ({
          alerts: [String(cause)],
          notes: [],
          rendered: false,
          screenshot: "",
        }))
      : null;
    const outcome: Outcome = { ...ran, render };
    outcomes.push(outcome);
    writeFileSync(log, `${JSON.stringify(outcome)}\n`, { flag: "a" });
    console.log(
      [
        kind,
        index + 1,
        ran.runStatus,
        ran.createdKind ?? "-",
        render?.rendered ? "RENDERED" : "no",
        ran.msToSaved === null ? "" : `${Math.round(ran.msToSaved / 1000)}s`,
        `${ran.modelCalls} calls`,
        render?.alerts.join(" | ") ?? "",
      ].join("\t")
    );
  }
}
await browser.close();

const rows = kinds.map((kind) => {
  const mine = outcomes.filter((each) => each.kind === kind);
  const rendered = mine.filter(
    (each) => each.render?.rendered && each.createdKind === kind
  );
  const times = rendered
    .map((each) => each.msToSaved ?? 0)
    .sort((a, b) => a - b);
  const median = times.length > 0 ? times[Math.floor(times.length / 2)] : null;
  const invalid = mine.reduce(
    (total, each) =>
      total +
      each.attempts.filter(
        (attempt) =>
          typeof attempt.output === "object" &&
          attempt.output !== null &&
          "status" in attempt.output &&
          attempt.output.status === "invalid"
      ).length,
    0
  );
  return `| ${kind} | ${rendered.length}/${mine.length} | ${mine.filter((each) => each.artifactId).length} | ${invalid} | ${median === null ? "-" : `${Math.round((median ?? 0) / 1000)}s`} |`;
});
const summary = [
  "| Kind | Rendered (right kind) | Saved (any kind) | Invalid saves | Median send→saved |",
  "|---|---|---|---|---|",
  ...rows,
].join("\n");
const totalCalls = outcomes.reduce((total, each) => total + each.modelCalls, 0);
writeFileSync(
  join(out, "SUMMARY.md"),
  `${summary}\n\nModel calls: ${totalCalls}\n`
);
console.log(`model calls: ${totalCalls}`);
console.log(summary);
