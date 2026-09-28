import { describe, expect, it } from "vitest";

import type { Answers } from "./answers";
import type { CurrentFiles } from "./current";
import {
  type Check,
  formatChecks,
  hasFailures,
  parseComposePs,
  runDoctor,
} from "./doctor";
import {
  demoAnswers,
  FAKE_KEYS,
  fakeRandom,
  firstRun,
  localAnswers,
} from "./fixtures";
import { FILES, planChanges } from "./plan";
import { type Command, createFakeHttp, createFakeRunner } from "./system";

// Every probe is faked: no Docker, no network, no real ports.

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

const RUNNING = [
  { Service: "web", State: "running" },
  { Service: "postgres", State: "running" },
  { Service: "sandbox-runner", State: "running" },
]
  .map((row) => JSON.stringify(row))
  .join("\n");

const dockerUp = (command: Command) => {
  const args = command.args.join(" ");
  if (args.startsWith("version")) {
    return { stdout: "28.4.0\n" };
  }
  if (args.startsWith("compose version")) {
    return { stdout: "2.39.2\n" };
  }
  return args.startsWith("compose ps") ? { stdout: RUNNING } : {};
};

const healthyHttp = createFakeHttp({
  "http://localhost:3000/api/health?ready=true": { status: 200 },
  "http://localhost:7070/healthz": { status: 200 },
  "http://localhost:7070/v1/sandboxes": { status: 401 },
  "https://api.anthropic.com/v1/models": { status: 200 },
});

const byLabel = (checks: readonly Check[], label: string) =>
  checks.find((check) => check.label === label);

describe("runDoctor", () => {
  it("passes a healthy demo stack", async () => {
    const checks = await runDoctor(filesFor(demoAnswers), {
      http: healthyHttp,
      portInUse: () => Promise.resolve(true),
      runner: createFakeRunner(dockerUp),
    });
    expect(hasFailures(checks)).toBe(false);
    expect(formatChecks(checks)).toMatchSnapshot();
  });

  it("sends the key only to its provider, and never prints it", async () => {
    const seen: [string, Readonly<Record<string, string>> | undefined][] = [];
    const checks = await runDoctor(filesFor(demoAnswers), {
      http: (url, headers) => {
        seen.push([url, headers]);
        return healthyHttp(url, headers);
      },
      portInUse: () => Promise.resolve(false),
      runner: createFakeRunner(dockerUp),
    });
    const withKey = seen.filter(([, headers]) =>
      Object.values(headers ?? {}).some((value) =>
        value.includes(FAKE_KEYS.anthropic)
      )
    );
    expect(withKey.map(([url]) => url)).toEqual([
      "https://api.anthropic.com/v1/models",
    ]);
    expect(formatChecks(checks)).not.toContain(FAKE_KEYS.anthropic);
  });

  it("says how to fix each failure", async () => {
    // A taken port, a database that's down, a runner started before the
    // token existed and a rejected key.
    const checks = await runDoctor(filesFor(demoAnswers), {
      http: createFakeHttp({
        "http://localhost:3000/api/health?ready=true": {
          body: JSON.stringify({
            data: {
              checks: {
                database: { message: "connection refused", status: "down" },
                jobs: { message: null, status: "up" },
              },
              status: "degraded",
            },
          }),
          status: 503,
        },
        "http://localhost:7070/healthz": { status: 200 },
        "http://localhost:7070/v1/sandboxes": { status: 503 },
        "https://api.anthropic.com/v1/models": { status: 401 },
      }),
      portInUse: (port) => Promise.resolve(port === 5432),
      runner: createFakeRunner((command) =>
        command.args[0] === "compose" && command.args[1] === "ps"
          ? { stdout: JSON.stringify([{ Service: "web", State: "running" }]) }
          : dockerUp(command)
      ),
    });
    expect(hasFailures(checks)).toBe(true);
    expect(byLabel(checks, "Port 5432 (postgres)")).toMatchObject({
      detail: "in use, but not by this checkout's compose stack",
      status: "fail",
    });
    expect(byLabel(checks, "App health")?.detail).toBe(
      "answers 503 (database: connection refused)"
    );
    expect(byLabel(checks, "Sandbox runner")?.detail).toBe(
      "running, but without SANDBOX_RUNNER_TOKEN"
    );
    expect(byLabel(checks, "Provider anthropic")?.detail).toBe(
      "the key was rejected (401)"
    );
    expect(byLabel(checks, "Models")?.status).toBe("fail");
    expect(formatChecks(checks)).toMatchSnapshot();
  });

  it("stops at Docker when the engine is down", async () => {
    const checks = await runDoctor(filesFor(demoAnswers), {
      http: createFakeHttp({}),
      portInUse: () => Promise.resolve(false),
      runner: createFakeRunner(() => ({ code: 1 })),
    });
    expect(byLabel(checks, "Docker")).toMatchObject({
      fix: "start Docker Desktop (or the Docker daemon), then try again",
      status: "fail",
    });
    expect(byLabel(checks, "App health")?.fix).toBe("bun run setup up");
  });

  it("flags an invalid config and missing files", async () => {
    const checks = await runDoctor(
      { ...firstRun, config: "limits: { requestsPerMinute: 0 }\n" },
      {
        http: createFakeHttp({}),
        portInUse: () => Promise.resolve(false),
        runner: createFakeRunner(dockerUp),
      }
    );
    expect(byLabel(checks, ".env")?.status).toBe("warn");
    expect(byLabel(checks, FILES.config)?.status).toBe("fail");
    expect(byLabel(checks, FILES.config)?.detail).toContain(
      "limits.requestsPerMinute"
    );
  });

  it("checks a local Ollama from this machine, and skips Docker on PGlite", async () => {
    const runner = createFakeRunner();
    const checks = await runDoctor(
      filesFor({ ...localAnswers, search: false }),
      {
        http: createFakeHttp({
          "http://localhost:11434/v1/models": { status: 200 },
        }),
        portInUse: () => Promise.resolve(false),
        runner,
      }
    );
    expect(runner.calls).toEqual([]);
    expect(byLabel(checks, "Provider ollama")?.status).toBe("ok");
    expect(byLabel(checks, "Models")?.status).toBe("ok");
  });
});

describe("parseComposePs", () => {
  it("reads both output formats and keeps running services", () => {
    const rows = [
      { Service: "web", State: "running" },
      { Service: "postgres", State: "exited" },
    ];
    expect(parseComposePs(JSON.stringify(rows))).toEqual(new Set(["web"]));
    expect(
      parseComposePs(rows.map((row) => JSON.stringify(row)).join("\n"))
    ).toEqual(new Set(["web"]));
    expect(parseComposePs("")).toEqual(new Set());
  });
});

describe("sign-in address (054)", () => {
  const signInCheck = async (env: string, answers: Answers = demoAnswers) => {
    const files = filesFor(answers);
    const checks = await runDoctor(
      { ...files, env: `${files.env ?? ""}\n${env}\n` },
      {
        http: healthyHttp,
        portInUse: () => Promise.resolve(true),
        runner: createFakeRunner(dockerUp),
      }
    );
    return byLabel(checks, "Sign-in address");
  };

  it("names the address to open, and its loopback aliases", async () => {
    expect(await signInCheck("")).toEqual({
      detail:
        "open http://localhost:3000 (127.0.0.1 and [::1] work too); other addresses need TRUSTED_ORIGINS in .env",
      label: "Sign-in address",
      status: "ok",
    });
    expect(
      (
        await signInCheck(
          "BETTER_AUTH_URL=https://chat.example.com\nTRUSTED_ORIGINS=https://chat.example.org"
        )
      )?.detail
    ).toBe(
      "open https://chat.example.com, or an origin listed in TRUSTED_ORIGINS"
    );
  });

  it("warns when BETTER_AUTH_URL's port isn't where the app is", async () => {
    expect(
      await signInCheck("BETTER_AUTH_URL=http://127.0.0.1:3001")
    ).toMatchObject({
      fix: "set BETTER_AUTH_URL=http://127.0.0.1:3000 in .env",
      status: "warn",
    });
  });

  it("flags a BETTER_AUTH_URL that isn't a URL, and the unchecked list", async () => {
    expect(
      (await signInCheck("BETTER_AUTH_URL=chat.example.com"))?.status
    ).toBe("fail");
    expect(
      await signInCheck("BETTER_AUTH_TRUSTED_ORIGINS=https://*.example.com")
    ).toMatchObject({
      fix: "move those origins to TRUSTED_ORIGINS in .env (exact origins only)",
      status: "warn",
    });
  });
});
