import { join } from "node:path";

import { err, ok, type Result } from "@workspace/shared/result";

import type { Defaults } from "./answers";
import { type CurrentFiles, currentEnv, readDefaults } from "./current";
import type { EnvValues } from "./env-file";
import { FILES } from "./plan";
import type { Command, Runner } from "./system";

// `bun run setup up`: start what the files describe. Docker mode builds and
// starts the whole stack with the right compose profiles. Local mode starts
// only the services `bun dev` leans on (Postgres, the sandbox runner,
// SearXNG), then runs `bun dev` with `.env` and the config handed to it.

export type UpStep = Command & {
  readonly label: string;
  /**
   * A Docker step `bun dev` works without: with no Docker it's skipped, and
   * this line says so and what to run later.
   */
  readonly withoutDocker?: string;
};

export interface UpPlan {
  readonly steps: readonly UpStep[];
  /** Where the app will answer. */
  readonly url: string;
}

const RUNNER_START = "docker compose --profile sandbox up -d sandbox-runner";

const profilesFor = (
  settings: Pick<Defaults, "artifacts" | "sandbox" | "search">,
  withArtifacts: boolean
): string[] =>
  [
    settings.sandbox === "docker" && "sandbox",
    settings.search && "search",
    withArtifacts && settings.artifacts && "artifacts",
  ]
    .filter((profile): profile is string => Boolean(profile))
    .flatMap((profile) => ["--profile", profile]);

/** Everything `.env` sets, minus the blanks, for the `bun dev` process. */
const devEnvironment = (env: EnvValues): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));

/** `root` is the repo root, for the absolute `CONFIG_PATH` that `bun dev` needs. */
export const planUp = (files: CurrentFiles, root: string): UpPlan => {
  const settings = readDefaults(files);
  const env = currentEnv(files);

  if (settings.mode === "docker") {
    return {
      steps: [
        {
          args: [
            "compose",
            ...profilesFor(settings, true),
            "up",
            "-d",
            "--build",
            "--wait",
          ],
          command: "docker",
          inherit: true,
          label:
            "Building and starting the stack (the first build takes a few minutes)",
        },
      ],
      url: `http://localhost:${env.WEB_PORT || "3000"}`,
    };
  }

  const services = [
    settings.database === "postgres" && "postgres",
    settings.search && "searxng",
  ].filter((service): service is string => Boolean(service));
  const compose: UpStep[] =
    services.length > 0
      ? [
          {
            args: [
              "compose",
              ...profilesFor({ ...settings, sandbox: "none" }, false),
              "up",
              "-d",
              "--wait",
              ...services,
            ],
            command: "docker",
            inherit: true,
            label: `Starting ${services.join(", ")} in Docker`,
          },
        ]
      : [];
  // Previews need the runner in Docker, so without Docker it waits.
  const runner: UpStep[] =
    settings.sandbox === "docker"
      ? [
          {
            args: [
              "compose",
              "--profile",
              "sandbox",
              "up",
              "-d",
              "--build",
              "--wait",
              "sandbox-runner",
            ],
            command: "docker",
            inherit: true,
            label: "Starting the sandbox runner in Docker",
            withoutDocker: `Sandbox runner not started: Docker isn't running. Start Docker, then run: ${RUNNER_START}`,
          },
        ]
      : [];
  return {
    steps: [
      ...compose,
      ...runner,
      {
        // turbo passes only the variables a task declares unless told
        // otherwise, and `next dev` reads apps/web/.env, not this one.
        args: [
          "turbo",
          "run",
          "dev",
          "--env-mode=loose",
          "--filter=web",
          ...(settings.artifacts ? ["--filter=artifacts"] : []),
        ],
        command: "bun",
        env: {
          ...devEnvironment(env),
          CONFIG_PATH: join(root, FILES.config),
        },
        inherit: true,
        label: "Starting bun dev (Ctrl-C stops it)",
      },
    ],
    url: `http://localhost:${env.PORT || "3000"}`,
  };
};

export type UpError =
  | { readonly type: "no-docker" }
  | { readonly command: string; readonly type: "failed" };

/** Ctrl-C: how `bun dev` normally ends. */
const INTERRUPTED = 130;

const needsDocker = (plan: UpPlan): boolean =>
  plan.steps.some((step) => step.command === "docker");

const requiresDocker = (plan: UpPlan): boolean =>
  plan.steps.some(
    (step) => step.command === "docker" && step.withoutDocker === undefined
  );

export interface UpDeps {
  readonly print: (message: string) => void;
  readonly runner: Runner;
}

export const runUp = async (
  plan: UpPlan,
  { print, runner }: UpDeps
): Promise<Result<string, UpError>> => {
  // The daemon, not just the CLI: compose can't start anything without it.
  const docker =
    needsDocker(plan) &&
    (
      await runner.run({
        args: ["info", "--format", "{{.ServerVersion}}"],
        command: "docker",
      })
    ).code === 0;
  if (!docker && requiresDocker(plan)) {
    return err({ type: "no-docker" });
  }
  for (const step of plan.steps) {
    if (step.command === "docker" && !docker && step.withoutDocker) {
      print(step.withoutDocker);
      continue;
    }
    print(step.label);
    // `bun dev` runs until Ctrl-C, so say where to look before it starts.
    if (step.command === "bun") {
      print(`The app will be on ${plan.url}`);
    }
    // biome-ignore lint/performance/noAwaitInLoops: each step needs the one before it.
    const result = await runner.run(step);
    if (
      !(
        result.code === 0 ||
        (step.command === "bun" && result.code === INTERRUPTED)
      )
    ) {
      return err({
        command: [step.command, ...step.args].join(" "),
        type: "failed",
      });
    }
  }
  return ok(plan.url);
};
