#!/usr/bin/env bun
/**
 * Rebuilds a live run's reports from its trials with today's classifier,
 * with no model calls: `<kind>.md`, `summary.json` and `summary.md`.
 *
 *   bun packages/evals/src/artifacts/report.ts --dir <live --out dir>
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  classifyTrial,
  kindReport,
  summarizeKind,
  summaryTable,
  trialSchema,
} from "./trial";

const { values } = parseArgs({ options: { dir: { type: "string" } } });
const { dir } = values;
if (!dir) {
  throw new Error("Pass --dir <the live run's --out directory>.");
}

const kinds = (await readdir(dir))
  .filter((name) => name.endsWith(".json") && !name.startsWith("summary"))
  .map((name) => name.slice(0, -".json".length));

const summaries = await Promise.all(
  kinds.map(async (kind) => {
    const path = join(dir, `${kind}.json`);
    const trials = trialSchema
      .array()
      .parse(JSON.parse(await readFile(path, "utf8")))
      .map((trial) => ({
        ...trial,
        verdict: classifyTrial(kind, trial.observation),
      }));
    await writeFile(path, JSON.stringify(trials, null, 2));
    const summary = summarizeKind(kind, trials);
    await writeFile(join(dir, `${kind}.md`), kindReport(summary, trials));
    return { model: trials[0]?.model ?? "", summary };
  })
);
const models = [...new Set(summaries.map((each) => each.model))].join(", ");
const table = summaryTable(summaries.map((each) => each.summary));
await writeFile(
  join(dir, "summary.json"),
  JSON.stringify(
    summaries.map((each) => each.summary),
    null,
    2
  )
);
await writeFile(
  join(dir, "summary.md"),
  `# Live artifact eval\n\nModel: ${models}\n\n${table}\n`
);
process.stdout.write(`${table}\n`);
