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
