import {
  type ConfigError,
  formatConfigErrors,
  parseConfig,
} from "@workspace/config/parse";
import { err, ok, type Result } from "@workspace/shared/result";

import { type Answers, OLLAMA_URL_FROM_DOCKER } from "./answers";
import { updateConfig } from "./config-file";
import type { CurrentFiles } from "./current";
import {
  type EnvUpdates,
  type EnvValues,
  parseEnv,
  updateEnv,
} from "./env-file";
import { updateOverride } from "./override-file";

// Answers in, file contents out: the whole wizard minus the prompts and the
// disk. Pure, so tests can snapshot what a set of answers writes.

export const FILES = {
  config: "app.config.yaml",
  configExample: "app.config.example.yaml",
  env: ".env",
  envExample: ".env.example",
  override: "docker-compose.override.yml",
} as const;

export type TargetFile =
  | typeof FILES.config
  | typeof FILES.env
  | typeof FILES.override;

export interface FileChange {
  readonly after: string;
  /** The file's contents now; `undefined` when it doesn't exist yet. */
  readonly before: string | undefined;
  readonly path: TargetFile;
}

/** A new random secret (hex); `node:crypto` in the shell, fixed in tests. */
export type RandomSecret = () => string;

const EXAMPLE_SEARXNG_SECRET = "dev-only-change-me";
const LOCAL_URLS = {
  artifacts: "http://artifacts.localhost:3910",
  runner: "http://localhost:7070",
  searxng: "http://localhost:8080",
} as const;

const localDatabaseUrl = (env: EnvValues): string =>
  `postgres://${env.POSTGRES_USER || "postgres"}:${env.POSTGRES_PASSWORD || "postgres"}@localhost:${env.POSTGRES_PORT || "5432"}/${env.POSTGRES_DB || "app"}`;

/** What `.env` gets. Existing values win wherever the answer doesn't change them. */
export const envUpdates = (
  answers: Answers,
  env: EnvValues,
  random: RandomSecret
): EnvUpdates => {
  const updates: Record<string, string | null> = { ...answers.keys };

  // Compose points `web` at its own Postgres; DATABASE_URL is for `bun dev`.
  if (answers.mode === "local") {
    updates.DATABASE_URL =
      answers.database === "pglite"
        ? null
        : env.DATABASE_URL || localDatabaseUrl(env);
  }

  if (answers.sandbox === "docker") {
    updates.SANDBOX_RUNNER_TOKEN = env.SANDBOX_RUNNER_TOKEN || random();
    updates.SANDBOX_EGRESS = answers.egress;
    updates.SANDBOX_RUNNER_URL = env.SANDBOX_RUNNER_URL || LOCAL_URLS.runner;
  }

  if (answers.search) {
    updates.SEARXNG_URL = env.SEARXNG_URL || LOCAL_URLS.searxng;
    const secret = env.SEARXNG_SECRET;
    updates.SEARXNG_SECRET =
      secret && secret !== EXAMPLE_SEARXNG_SECRET ? secret : random();
  } else {
    // Set, it makes SearXNG the backend even with no container to answer.
    updates.SEARXNG_URL = null;
  }

  // Set, it sends React and Mermaid previews to that origin.
  updates.ARTIFACTS_ORIGIN = answers.artifacts
    ? env.ARTIFACTS_ORIGIN || LOCAL_URLS.artifacts
    : null;

  // Build args: the image compiles its icon set in (D19).
  updates.ICON_SET = answers.icons.set;
  updates.ICON_STYLE =
    answers.icons.set === "material" ? answers.icons.style : null;

  return updates;
};

const HOST_FROM_DOCKER = new URL(OLLAMA_URL_FROM_DOCKER).hostname;

const usesHostGateway = (answers: Answers): boolean =>
  answers.providers.includes("compatible") &&
  answers.compatible !== null &&
  new URL(answers.compatible.baseURL).hostname === HOST_FROM_DOCKER;

export interface PlanError {
  readonly errors: readonly ConfigError[];
  /** Readable, one line per problem; never includes a value. */
  readonly message: string;
}

/**
 * The files to write, only those that change. The config is validated with
 * the app's own schema against the `.env` being written, so the wizard never
 * leaves a file the app would refuse to boot with.
 */
export const planChanges = (
  files: CurrentFiles,
  answers: Answers,
  random: RandomSecret
): Result<readonly FileChange[], PlanError> => {
  const envBase = files.env ?? files.envExample;
  const envAfter = updateEnv(
    envBase,
    envUpdates(answers, parseEnv(envBase), random)
  );
  const newEnv = parseEnv(envAfter);

  const configAfter = updateConfig(
    files.config ?? files.configExample,
    answers,
    newEnv
  );
  const parsed = parseConfig(configAfter, newEnv);
  if (!parsed.ok) {
    return err({
      errors: parsed.error,
      message: formatConfigErrors(parsed.error, FILES.config),
    });
  }

  const changes: FileChange[] = [
    { after: envAfter, before: files.env, path: FILES.env },
    { after: configAfter, before: files.config, path: FILES.config },
  ];
  if (answers.mode === "docker") {
    changes.push({
      after: updateOverride(files.override, {
        hostGateway: usesHostGateway(answers),
      }),
      before: files.override,
      path: FILES.override,
    });
  }
  return ok(changes.filter((change) => change.before !== change.after));
};
