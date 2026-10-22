#!/usr/bin/env bun
/**
 * Renders every artifact in one chat through `render.ts` and prints each
 * verdict: how the renderer's own detection is checked against known-good
 * artifacts (the gallery) before it judges a model's.
 *
 *   bun packages/evals/src/artifacts/render-check.ts --chat <id> [--out <dir>]
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createRenderer } from "./render";
import { signIn } from "./session";

const { values } = parseArgs({
  options: {
    "base-url": { default: "http://localhost:3101", type: "string" },
    chat: { type: "string" },
    out: { default: ".evals/render-check", type: "string" },
  },
});
const baseUrl = values["base-url"];
const { chat } = values;
if (!chat) {
  throw new Error("Pass --chat <conversation id>.");
}
const session = await signIn(baseUrl);
const artifacts = await session.api.artifacts.list({ conversationId: chat });
await mkdir(values.out, { recursive: true });
const renderer = await createRenderer({ baseUrl, cookie: session.cookie });
try {
  for (const artifact of artifacts) {
    // biome-ignore lint/performance/noAwaitInLoops: one browser page at a time.
    const seen = await renderer.render({
      conversationId: chat,
      kind: artifact.kind,
      screenshot: join(values.out, `${artifact.kind}.png`),
      title: artifact.title,
    });
    process.stdout.write(
      `${artifact.kind}\t${seen.status}\t${seen.ms} ms\t${seen.message ?? ""}\n`
    );
  }
} finally {
  await renderer.close();
}
