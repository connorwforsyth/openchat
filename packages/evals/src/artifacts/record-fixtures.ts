#!/usr/bin/env bun
/**
 * Turns a live run's failed trials into offline fixtures: each failure's
 * artifact tool calls, as the model made them, with what went wrong. The
 * replay test (`packages/ai/evals/artifacts/recorded-live.test.ts`) runs
 * them through `create_artifact` with no model, so a change to a kind's
 * checks shows against real model output.
 *
 *   bun packages/evals/src/artifacts/record-fixtures.ts --from <live --out dir>
 *     [--to packages/ai/evals/artifacts/recorded-live.json]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ARTIFACT_TOOLS, type Trial, trialSchema } from "./trial";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: {
      default: "packages/ai/evals/artifacts/recorded-live.json",
      type: "string",
    },
  },
});
const { from } = values;
if (!from) {
  throw new Error("Pass --from <the live run's --out directory>.");
}

const files = (await readdir(from)).filter(
  (name) => name.endsWith(".json") && !name.startsWith("summary")
);
const trials: Trial[] = (
  await Promise.all(
    files.map(async (name) =>
      trialSchema
        .array()
        .parse(JSON.parse(await readFile(join(from, name), "utf8")))
    )
  )
).flat();

const fixtures = trials
  .filter((trial) => trial.verdict.category !== null)
  .map((trial) => ({
    calls: trial.observation.calls
      .filter((call) =>
        (ARTIFACT_TOOLS as readonly string[]).includes(call.name)
      )
      .map((call) => ({ input: call.input, name: call.name })),
    category: trial.verdict.category,
    detail: trial.verdict.detail,
    id: trial.promptId,
    kind: trial.kind,
    model: trial.model,
    prompt: trial.prompt,
    text: trial.observation.text,
  }))
  .toSorted((a, b) => a.id.localeCompare(b.id));

await writeFile(values.to, `${JSON.stringify(fixtures, null, 2)}\n`);
process.stdout.write(`${fixtures.length} failures recorded to ${values.to}\n`);
