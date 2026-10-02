import { describe, expect, it } from "vitest";

import type { Answers } from "./answers";
import type { CurrentFiles } from "./current";
import {
  demoAnswers,
  everythingAnswers,
  FAKE_KEYS,
  fakeRandom,
  firstRun,
  localAnswers,
} from "./fixtures";
import { FILES, planChanges } from "./plan";
import { createFakeRunner } from "./system";
import { planUp, runUp } from "./up";

// Commands only: the runner is a fake, so no test starts a container.

const filesFor = (answers: Answers): CurrentFiles => {
  const plan = planChanges(firstRun, answers, fakeRandom());
  if (!plan.ok) {
    throw new Error(plan.error.message);
  }
  const after = Object.fromEntries(
    plan.value.map((change) => [change.path, change.after])
  );
  return {
    ...firstRun,
    config: after[FILES.config],
    env: after[FILES.env],
    override: after[FILES.override],
  };
};

const commandLines = (plan: ReturnType<typeof planUp>) =>
  plan.steps.map((step) => [step.command, ...step.args].join(" "));

describe("planUp", () => {
  it("builds and starts the demo stack with the sandbox profile", () => {
    const plan = planUp(filesFor(demoAnswers), "/repo");
    expect(commandLines(plan)).toEqual([
      "docker compose --profile sandbox up -d --build --wait",
    ]);
    expect(plan.url).toBe("http://localhost:3000");
  });

  it("adds a profile per optional service", () => {
    expect(commandLines(planUp(filesFor(everythingAnswers), "/repo"))).toEqual([
      "docker compose --profile search --profile artifacts up -d --build --wait",
    ]);
  });

  it("follows WEB_PORT", () => {
    const files = filesFor(demoAnswers);
    const plan = planUp(
      { ...files, env: `${files.env}WEB_PORT=3300\n` },
      "/repo"
    );
    expect(plan.url).toBe("http://localhost:3300");
  });

  it("runs bun dev locally with .env and the config handed over", () => {
    const plan = planUp(filesFor(localAnswers), "/repo");
    expect(commandLines(plan)).toEqual([
      "docker compose --profile search up -d --wait searxng",
      "bun turbo run dev --env-mode=loose --filter=web --filter=artifacts",
    ]);
    const dev = plan.steps.at(-1);
    expect(dev?.env).toMatchObject({
      ARTIFACTS_ORIGIN: "http://artifacts.localhost:3910",
      CONFIG_PATH: "/repo/app.config.yaml",
    });
    // The icon set comes from the config's icons block (130).
    expect(dev?.env).not.toHaveProperty("ICON_SET");
    // Empty values stay unset, so PGlite is used rather than an empty URL.
    expect(dev?.env).not.toHaveProperty("DATABASE_URL");
  });

  it("starts Postgres and the runner for local dev when they're chosen", () => {
    const plan = planUp(
      filesFor({
        ...localAnswers,
        database: "postgres",
        sandbox: "docker",
        search: false,
      }),
      "/repo"
    );
    expect(commandLines(plan)[0]).toBe(
      "docker compose --profile sandbox up -d --build --wait postgres sandbox-runner"
    );
  });

  it("passes keys to bun dev through the environment, never the arguments", () => {
    const plan = planUp(
      filesFor({
        ...localAnswers,
        keys: { OLLAMA_API_KEY: FAKE_KEYS.gateway },
      }),
      "/repo"
    );
    expect(commandLines(plan).join("\n")).not.toContain(FAKE_KEYS.gateway);
  });
});

describe("runUp", () => {
  const plan = planUp(filesFor(demoAnswers), "/repo");

  it("checks for Docker, then runs each step", async () => {
    const runner = createFakeRunner();
    const printed: string[] = [];
    const result = await runUp(plan, {
      print: (line) => printed.push(line),
      runner,
    });
    expect(result).toEqual({ ok: true, value: "http://localhost:3000" });
    expect(runner.calls.map((call) => call.args.join(" "))).toEqual([
      "compose version",
      "compose --profile sandbox up -d --build --wait",
    ]);
    expect(runner.calls[1]?.inherit).toBe(true);
  });

  it("stops before building when Docker isn't there", async () => {
    const runner = createFakeRunner(() => ({ code: 127 }));
    const result = await runUp(plan, { print: () => undefined, runner });
    expect(result).toEqual({ error: { type: "no-docker" }, ok: false });
    expect(runner.calls).toHaveLength(1);
  });

  it("reports the step that failed", async () => {
    const runner = createFakeRunner((command) => ({
      code: command.args.includes("up") ? 1 : 0,
    }));
    const result = await runUp(plan, { print: () => undefined, runner });
    expect(result).toEqual({
      error: {
        command: "docker compose --profile sandbox up -d --build --wait",
        type: "failed",
      },
      ok: false,
    });
  });

  it("treats Ctrl-C in bun dev as a normal exit", async () => {
    const local = planUp(filesFor(localAnswers), "/repo");
    const runner = createFakeRunner((command) => ({
      code: command.command === "bun" ? 130 : 0,
    }));
    const printed: string[] = [];
    const result = await runUp(local, {
      print: (line) => printed.push(line),
      runner,
    });
    expect(result.ok).toBe(true);
    expect(printed).toContain("The app will be on http://localhost:3000");
  });
});
