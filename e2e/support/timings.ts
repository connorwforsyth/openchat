import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { type Page, test } from "@playwright/test";
import { z } from "zod";

// D27: "measure from the first byte". The suite records TTFB, the
// `composer:ready` mark and first-token latency, attaches them to the test
// that measured them, and prints them together after the run
// (print-timings.ts). They're reported, not asserted: CI machines vary too
// much for a fixed budget to mean anything yet.

const file = fileURLToPath(
  new URL("../test-results/timings.jsonl", import.meta.url)
);
// Written by the server (`RUN_TIMINGS_FILE`, set by serve.ts).
const serverFile = fileURLToPath(
  new URL("../test-results/server-timings.jsonl", import.meta.url)
);

const timingSchema = z.object({
  metric: z.string(),
  ms: z.number(),
  where: z.string(),
});
export type Timing = z.infer<typeof timingSchema>;

export const recordTiming = async (
  metric: string,
  ms: number,
  where: string
) => {
  const rounded = Math.round(ms);
  test.info().annotations.push({ description: `${rounded} ms`, type: metric });
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({ metric, ms: rounded, where })}\n`);
};

export const readTimings = async (): Promise<Timing[]> => {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => timingSchema.parse(JSON.parse(line)));
};

/** TTFB and `composer:ready` for the page's last navigation. */
export const recordBootTimings = async (page: Page, where: string) => {
  const marks = await page.evaluate(async () => {
    const readyMark = () =>
      performance.getEntriesByName("composer:ready", "mark")[0];
    // The mark lands once the editor chunk has hydrated over the shell.
    for (let tries = 0; !readyMark() && tries < 100; tries += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: waiting on the page, one tick at a time.
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      composerReady: readyMark()?.startTime ?? null,
      ttfb: navigation ? navigation.responseStart - navigation.startTime : null,
    };
  });
  if (marks.ttfb !== null) {
    await recordTiming("TTFB", marks.ttfb, where);
  }
  if (marks.composerReady === null) {
    throw new Error(`no composer:ready mark on ${where}`);
  }
  await recordTiming("composer:ready", marks.composerReady, where);
};

// Ticket 102: where a send's first-token latency goes. The page side is the
// requests a send makes, timed from the Enter keydown; the server side is
// each run's timing marks (`packages/server/src/runs/timing.ts`).

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The requests a send makes, as `requestPhases` reports them. */
const SEND_REQUESTS = [
  { end: true, metric: "send → chat created", path: "POST /api/conversations" },
  { end: false, metric: "send → run requested", path: "POST /api/runs" },
  { end: true, metric: "send → run created", path: "POST /api/runs" },
  {
    end: false,
    metric: "send → stream requested",
    path: "GET /api/runs/:id/stream",
  },
  {
    end: true,
    metric: "send → stream headers",
    path: "GET /api/runs/:id/stream",
  },
] as const;

/**
 * Starts timing the page's API requests: when each was made and when its
 * headers came back. Call before sending; it resets what an earlier send
 * recorded.
 */
export const watchRequests = async (page: Page) => {
  await page.evaluate((uuid) => {
    const holder = window as unknown as {
      __requests?: { end?: number; path: string; start: number }[];
    };
    const first = holder.__requests === undefined;
    holder.__requests = [];
    if (!first) {
      return;
    }
    const pattern = new RegExp(uuid, "gi");
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      // Read, not copied: `new Request(input)` would use up its body.
      const isRequest = input instanceof Request;
      const method = (
        init?.method ?? (isRequest ? input.method : "GET")
      ).toUpperCase();
      const url = new URL(isRequest ? input.url : String(input), location.href);
      const entry: { end?: number; path: string; start: number } = {
        path: `${method} ${url.pathname.replace(pattern, ":id")}`,
        start: performance.now(),
      };
      holder.__requests?.push(entry);
      const response = original(input, init);
      response
        .then(() => {
          entry.end = performance.now();
        })
        .catch(() => undefined);
      return response;
    };
  }, UUID.source);
};

/** Records when each of a send's requests went and came back, from `start`. */
export const recordSendPhases = async (
  page: Page,
  start: number,
  where: string
) => {
  const requests = await page.evaluate(
    () =>
      (
        window as unknown as {
          __requests?: { end?: number; path: string; start: number }[];
        }
      ).__requests ?? []
  );
  for (const phase of SEND_REQUESTS) {
    const request = requests.find((each) => each.path === phase.path);
    const at = phase.end ? request?.end : request?.start;
    if (at !== undefined) {
      // biome-ignore lint/performance/noAwaitInLoops: appended in order, a handful.
      await recordTiming(phase.metric, at - start, where);
    }
  }
};

const STREAM_OPENED = "stream.opened";

const serverMarkSchema = z.object({
  at: z.number(),
  phase: z.string(),
  runId: z.string(),
});

/**
 * Each server phase's duration per run that streamed text: the gap since
 * the mark before it, first pass only (a run resumed after approvals marks
 * its phases again).
 */
export const readServerPhases = async (): Promise<
  Map<string, readonly number[]>
> => {
  const text = await readFile(serverFile, "utf8").catch(() => "");
  const byRun = new Map<string, z.infer<typeof serverMarkSchema>[]>();
  for (const line of text.split("\n").filter(Boolean)) {
    const mark = serverMarkSchema.parse(JSON.parse(line));
    const own = byRun.get(mark.runId) ?? [];
    if (!own.some((each) => each.phase === mark.phase)) {
      byRun.set(mark.runId, [...own, mark]);
    }
  }
  const phases = new Map<string, number[]>();
  const add = (phase: string, ms: number) =>
    phases.set(phase, [...(phases.get(phase) ?? []), ms]);
  for (const marks of byRun.values()) {
    // The client's stream request runs alongside the run, so it's timed
    // from the run's arrival rather than from the mark before it.
    const received = marks.find((mark) => mark.phase === "run.received");
    const opened = marks.find((mark) => mark.phase === STREAM_OPENED);
    const sorted = marks
      .filter((mark) => mark.phase !== STREAM_OPENED)
      .sort((a, b) => a.at - b.at);
    const texted = sorted.find((mark) => mark.phase === "agent.first-text");
    if (!(received && texted)) {
      continue;
    }
    add("received → first text", texted.at - received.at);
    if (opened) {
      add("received → stream opened", opened.at - received.at);
    }
    sorted.slice(1).forEach((mark, index) => {
      const before = sorted[index];
      if (before) {
        add(mark.phase, mark.at - before.at);
      }
    });
  }
  return phases;
};
