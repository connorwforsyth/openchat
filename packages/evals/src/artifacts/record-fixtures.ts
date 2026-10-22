#!/usr/bin/env bun
/**
 * Turns a live run's failed trials, and those the tool refused a call in,
 * into offline fixtures: each one's artifact tool calls as the model made
 * them, with what went wrong. The replay test (`packages/ai/evals/artifacts/recorded-live.test.ts`) runs
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

const artifactCalls = (trial: Trial) =>
  trial.observation.calls.filter((call) =>
    (ARTIFACT_TOOLS as readonly string[]).includes(call.name)
  );

/** A call the tool refused: input that didn't parse, or content the checks didn't pass. */
const refused = (trial: Trial) =>
  artifactCalls(trial).some(
    (call) =>
      call.result === "error" ||
      (call.output as { status?: unknown } | null)?.status === "invalid"
  );

const fixtures = trials
  .filter((trial) => trial.verdict.category !== null || refused(trial))
  .map((trial) => ({
    calls: artifactCalls(trial).map((call) => ({
      input: call.input,
      name: call.name,
    })),
    // Rendered in the end, after the tool refused a call first.
    category: trial.verdict.category ?? "retried",
    detail: trial.verdict.detail,
    id: trial.promptId,
    kind: trial.kind,
    model: trial.model,
    prompt: trial.prompt,
    text: trial.observation.text,
  }))
  .toSorted((a, b) => a.id.localeCompare(b.id));

await writeFile(values.to, `${JSON.stringify(fixtures, null, 2)}\n`);
process.stdout.write(`${fixtures.length} fixtures recorded to ${values.to}\n`);
