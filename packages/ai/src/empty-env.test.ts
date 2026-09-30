import { readFileSync } from "node:fs";

import { appConfigSchema } from "@workspace/config/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// AGENTS.md: the app boots with an empty `.env`. Every module here must import
// and build its defaults with no provider keys and no network.

const saved = { ...process.env };
const SECRET_ENV = /KEY|TOKEN|SECRET|OPENAI|ANTHROPIC|GOOGLE|AZURE|AWS|OLLAMA/i;

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (SECRET_ENV.test(key)) {
      delete process.env[key];
    }
  }
});

afterAll(() => {
  Object.assign(process.env, saved);
});

const exported = Object.values(
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    .exports as Record<string, string>
).filter((path) => !path.includes("*"));

describe("with an empty env", () => {
  it.each(exported)("imports %s", async (path) => {
    await expect(
      import(new URL(`../${path}`, import.meta.url).href)
    ).resolves.toBeDefined();
  });

  it("builds a registry, a Decider and model options from an empty config", async () => {
    const { buildRegistry } = await import("./providers/registry");
    const { createDecider } = await import("./decider/from-config");
    const config = appConfigSchema.parse({});
    const registry = buildRegistry(config, {
      fetch: () => Promise.reject(new Error("no network in tests")),
    });
    expect(await registry.listModels({})).toEqual([]);
    const decider = createDecider(config, { keys: {}, registry });
    const answer = await decider.decide(
      { facts: {}, history: [], input: "hi" },
      [{ id: "q", prompt: "?", type: "boolean" }],
      { purpose: "intent" }
    );
    expect(answer).toMatchObject({ error: { type: "unavailable" }, ok: false });
  });
});
