import {
  type ConfigError,
  formatConfigErrors,
  parseConfig,
} from "@workspace/config/parse";
import type { AppConfig, ProviderConfig } from "@workspace/config/schema";
import { healthSchema } from "@workspace/contract/schemas/health";
import { z } from "zod";

import { OLLAMA_URL_FROM_DOCKER } from "./answers";
import { type CurrentFiles, currentEnv, readDefaults } from "./current";
import type { EnvValues } from "./env-file";
import { mountsConfig } from "./override-file";
import { FILES } from "./plan";
import type { HttpGet, PortInUse, Runner } from "./system";

// `bun run setup doctor`: read-only checks, each with the fix when it fails.
// It runs `docker version` and `docker compose ps`, knocks on ports, and
// GETs health endpoints and each provider's model list (free calls). It
// never starts, stops or changes anything, and never prints a key: provider
// failures report the status code, not the response.

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface Check {
  readonly detail: string;
  readonly fix?: string;
  readonly label: string;
  readonly status: CheckStatus;
}

export interface DoctorDeps {
  readonly http: HttpGet;
  readonly portInUse: PortInUse;
  readonly runner: Runner;
}

const SETUP = "bun run setup";
const UP = "bun run setup up";

const composeServiceSchema = z.object({
  Service: z.string(),
  State: z.string(),
});

/** `docker compose ps --format json`: an array (older) or one object per line. */
export const parseComposePs = (stdout: string): Set<string> => {
  const text = stdout.trim();
  if (!text) {
    return new Set();
  }
  const rows: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(text);
    rows.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  } catch {
    for (const line of text.split("\n")) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        // Not JSON: a warning compose printed; skip it.
      }
    }
  }
  return new Set(
    rows.flatMap((row) => {
      const service = composeServiceSchema.safeParse(row);
      return service.success && service.data.State === "running"
        ? [service.data.Service]
        : [];
    })
  );
};

const checkFiles = (files: CurrentFiles, docker: boolean): Check[] => [
  files.env === undefined
    ? {
        detail: "no .env: every setting is at its default",
        fix: SETUP,
        label: ".env",
        status: "warn",
      }
    : { detail: "present", label: ".env", status: "ok" },
  ...(docker
    ? [
        mountsConfig(files.override)
          ? {
              detail: "mounts app.config.yaml into web",
              label: FILES.override,
              status: "ok" as const,
            }
          : {
              detail: "web won't see app.config.yaml without the mount",
              fix: `${SETUP} (choose Docker) writes it`,
              label: FILES.override,
              status: "warn" as const,
            },
      ]
    : []),
];

const checkConfig = (
  files: CurrentFiles,
  env: EnvValues
): { readonly check: Check; readonly config: AppConfig | null } => {
  if (files.config === undefined) {
    const parsed = parseConfig("", env);
    return {
      check: {
        detail: "no app.config.yaml: the app runs on defaults (a local Ollama)",
        fix: SETUP,
        label: FILES.config,
        status: "warn",
      },
      config: parsed.ok ? parsed.value : null,
    };
  }
  const parsed = parseConfig(files.config, env);
  if (!parsed.ok) {
    return {
      check: {
        detail: `the app won't start with it:\n${formatConfigErrors(parsed.error as ConfigError[], FILES.config)}`,
        fix: `fix the lines above, or re-run ${SETUP}`,
        label: FILES.config,
        status: "fail",
      },
      config: null,
    };
  }
  return {
    check: { detail: "valid", label: FILES.config, status: "ok" },
    config: parsed.value,
  };
};

const checkDocker = async (runner: Runner): Promise<Check[]> => {
  const engine = await runner.run({
    args: ["version", "--format", "{{.Server.Version}}"],
    command: "docker",
  });
  if (engine.code !== 0) {
    return [
      {
        detail: "the Docker engine isn't answering",
        fix: "start Docker Desktop (or the Docker daemon), then try again",
        label: "Docker",
        status: "fail",
      },
    ];
  }
  const compose = await runner.run({
    args: ["compose", "version", "--short"],
    command: "docker",
  });
  return [
    { detail: `engine ${engine.stdout.trim()}`, label: "Docker", status: "ok" },
    compose.code === 0
      ? {
          detail: compose.stdout.trim(),
          label: "Docker Compose",
          status: "ok",
        }
      : {
          detail: "`docker compose` isn't available",
          fix: "install Docker Compose v2 (it ships with Docker Desktop)",
          label: "Docker Compose",
          status: "fail",
        },
  ];
};

interface PortSpec {
  readonly port: number;
  readonly service: string;
  readonly variable: string;
}

const portNumber = (env: EnvValues, variable: string, fallback: number) => {
  const value = Number(env[variable]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const checkPorts = async (
  specs: readonly PortSpec[],
  running: ReadonlySet<string>,
  portInUse: PortInUse
): Promise<Check[]> =>
  Promise.all(
    specs.map(async ({ port, service, variable }): Promise<Check> => {
      const label = `Port ${port} (${service})`;
      if (running.has(service)) {
        return { detail: `in use by ${service}`, label, status: "ok" };
      }
      return (await portInUse(port))
        ? {
            detail: `in use, but not by this checkout's compose stack`,
            fix: `stop whatever holds it (another program, or this app started from another folder), or set ${variable} in .env to a free port`,
            label,
            status: "fail",
          }
        : { detail: "free", label, status: "ok" };
    })
  );

const checkHealth = async (url: string, http: HttpGet): Promise<Check> => {
  const label = "App health";
  try {
    const response = await http(`${url}/api/health?ready=true`);
    if (response.status === 200) {
      return { detail: `${url} is up and ready`, label, status: "ok" };
    }
    const body = await response.text().catch(() => "");
    const report = healthSchema.safeParse(
      (() => {
        try {
          const parsed = JSON.parse(body) as { data?: unknown };
          return parsed.data ?? parsed;
        } catch {
          return null;
        }
      })()
    );
    const down = report.success
      ? Object.entries(report.data.checks)
          .filter(([, check]) => check.status === "down")
          .map(([name, check]) => `${name}: ${check.message ?? "down"}`)
      : [];
    return {
      detail: `answers ${response.status}${down.length > 0 ? ` (${down.join("; ")})` : ""}`,
      fix: "docker compose logs web (or the bun dev output) says why",
      label,
      status: "fail",
    };
  } catch {
    return {
      detail: `nothing answers on ${url}`,
      fix: UP,
      label,
      status: "fail",
    };
  }
};

const checkRunner = async (env: EnvValues, http: HttpGet): Promise<Check[]> => {
  const label = "Sandbox runner";
  if (!env.SANDBOX_RUNNER_TOKEN) {
    return [
      {
        detail:
          "SANDBOX_RUNNER_TOKEN is empty, so the runner refuses every call",
        fix: `${SETUP} (choose Docker sandboxes) generates one`,
        label,
        status: "fail",
      },
    ];
  }
  const base = `http://localhost:${portNumber(env, "SANDBOX_RUNNER_PORT", 7070)}`;
  try {
    const health = await http(`${base}/healthz`);
    if (health.status !== 200) {
      throw new Error(String(health.status));
    }
  } catch {
    return [
      {
        detail: `nothing answers on ${base}`,
        fix: `${UP} (starts the sandbox profile)`,
        label,
        status: "fail",
      },
    ];
  }
  // Unsigned, so a runner with a token answers 401 and one without, 503.
  const api = await http(`${base}/v1/sandboxes`).catch(() => null);
  return api?.status === 503
    ? [
        {
          detail: "running, but without SANDBOX_RUNNER_TOKEN",
          fix: `${UP} (recreates it with the token from .env)`,
          label,
          status: "fail",
        },
      ]
    : [{ detail: `up on ${base}`, label, status: "ok" }];
};

interface Probe {
  readonly headers: Record<string, string>;
  readonly url: string;
}

const TRAILING_SLASHES = /\/+$/;

/** The free "list models" call for each provider type we know how to ask. */
const modelListProbe = (provider: ProviderConfig): Probe | null => {
  const trim = (url: string) => url.replace(TRAILING_SLASHES, "");
  switch (provider.type) {
    case "anthropic":
      return provider.apiKey
        ? {
            headers: {
              "anthropic-version": "2023-06-01",
              "x-api-key": provider.apiKey,
            },
            url: `${trim(provider.baseURL ?? "https://api.anthropic.com/v1")}/models`,
          }
        : null;
    case "openai":
      return provider.apiKey
        ? {
            headers: { authorization: `Bearer ${provider.apiKey}` },
            url: `${trim(provider.baseURL ?? "https://api.openai.com/v1")}/models`,
          }
        : null;
    case "openai-compatible": {
      // Checked from this machine, where the container's host is localhost.
      const base = trim(provider.baseURL ?? "").replace(
        new URL(OLLAMA_URL_FROM_DOCKER).hostname,
        "localhost"
      );
      return {
        headers: provider.apiKey
          ? { authorization: `Bearer ${provider.apiKey}` }
          : {},
        url: `${base}/models`,
      };
    }
    default:
      return null;
  }
};

const checkModels = async (
  config: AppConfig,
  http: HttpGet
): Promise<Check[]> => {
  const checks = await Promise.all(
    Object.entries(config.providers).map(
      async ([id, provider]): Promise<Check> => {
        const label = `Provider ${id}`;
        const probe = modelListProbe(provider);
        if (!probe) {
          return provider.apiKey || provider.type === "openai-compatible"
            ? {
                detail: "not checked for this provider type",
                label,
                status: "skip",
              }
            : {
                detail: "no API key, so it's off",
                fix: `${SETUP} (or set its key in .env)`,
                label,
                status: "warn",
              };
        }
        try {
          const response = await http(probe.url, probe.headers);
          if (response.status === 200) {
            return { detail: "reachable, key accepted", label, status: "ok" };
          }
          const rejected = response.status === 401 || response.status === 403;
          return {
            detail: rejected
              ? `the key was rejected (${response.status})`
              : `answers ${response.status}`,
            fix: rejected
              ? `check the key in .env, or type it again with ${SETUP}`
              : "check the provider's status and its baseURL in app.config.yaml",
            label,
            status: "fail",
          };
        } catch {
          return {
            detail: `can't reach ${new URL(probe.url).origin}`,
            fix:
              provider.type === "openai-compatible"
                ? "start the server (for Ollama: ollama serve), or fix its baseURL"
                : "check this machine's network connection",
            label,
            status: "fail",
          };
        }
      }
    )
  );
  const reachable = checks.some((check) => check.status === "ok");
  return [
    ...checks,
    reachable
      ? {
          detail: "at least one model provider answers",
          label: "Models",
          status: "ok",
        }
      : {
          detail: "no model provider answers, so chats can't run",
          fix: `add a key with ${SETUP}, or start Ollama`,
          label: "Models",
          status: "fail",
        },
  ];
};

export const runDoctor = async (
  files: CurrentFiles,
  { http, portInUse, runner }: DoctorDeps
): Promise<Check[]> => {
  const settings = readDefaults(files);
  const env = currentEnv(files);
  const docker = settings.mode === "docker";
  const needsDocker =
    docker ||
    settings.database === "postgres" ||
    settings.sandbox === "docker" ||
    settings.search;

  const checks: Check[] = [...checkFiles(files, docker)];
  const { check: configCheck, config } = checkConfig(files, env);
  checks.push(configCheck);

  let running = new Set<string>();
  if (needsDocker) {
    const dockerChecks = await checkDocker(runner);
    checks.push(...dockerChecks);
    if (dockerChecks.every((check) => check.status === "ok")) {
      const ps = await runner.run({
        args: ["compose", "ps", "--format", "json"],
        command: "docker",
      });
      running = parseComposePs(ps.stdout);
    }
  }

  const ports: PortSpec[] = [
    ...(docker
      ? [
          {
            port: portNumber(env, "WEB_PORT", 3000),
            service: "web",
            variable: "WEB_PORT",
          },
        ]
      : []),
    ...(docker || settings.database === "postgres"
      ? [
          {
            port: portNumber(env, "POSTGRES_PORT", 5432),
            service: "postgres",
            variable: "POSTGRES_PORT",
          },
        ]
      : []),
    ...(settings.sandbox === "docker"
      ? [
          {
            port: portNumber(env, "SANDBOX_RUNNER_PORT", 7070),
            service: "sandbox-runner",
            variable: "SANDBOX_RUNNER_PORT",
          },
          {
            port: portNumber(env, "SANDBOX_PREVIEW_PORT", 7071),
            service: "sandbox-runner",
            variable: "SANDBOX_PREVIEW_PORT",
          },
        ]
      : []),
    ...(settings.search
      ? [
          {
            port: portNumber(env, "SEARXNG_PORT", 8080),
            service: "searxng",
            variable: "SEARXNG_PORT",
          },
        ]
      : []),
    ...(docker && settings.artifacts
      ? [
          {
            port: portNumber(env, "ARTIFACTS_PORT", 3910),
            service: "artifacts",
            variable: "ARTIFACTS_PORT",
          },
        ]
      : []),
  ];
  checks.push(...(await checkPorts(ports, running, portInUse)));

  const url = `http://localhost:${docker ? portNumber(env, "WEB_PORT", 3000) : portNumber(env, "PORT", 3000)}`;
  checks.push(await checkHealth(url, http));
  if (settings.sandbox === "docker") {
    checks.push(...(await checkRunner(env, http)));
  }
  if (config) {
    checks.push(...(await checkModels(config, http)));
  }
  return checks;
};

const marks: Record<CheckStatus, string> = {
  fail: "✗",
  ok: "✓",
  skip: "-",
  warn: "!",
};

/** One line per check, and an indented fix under each that has one. */
export const formatChecks = (checks: readonly Check[]): string =>
  checks
    .flatMap((check) => [
      `${marks[check.status]} ${check.label}: ${check.detail}`,
      ...(check.fix && check.status !== "ok" ? [`    fix: ${check.fix}`] : []),
    ])
    .join("\n");

export const hasFailures = (checks: readonly Check[]): boolean =>
  checks.some((check) => check.status === "fail");
