import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { serve } from "@hono/node-server";

import { createApp, createPreviewApp } from "./app";
import { createDockerodePort } from "./dockerode";
import { egressPolicy, envSchema } from "./env";
import { createPreviewUpgrade } from "./preview-upgrade";
import { createRunner, type Log } from "./runner";
import { selectRuntime } from "./spec";

// The imperative shell: read the environment, find out what the Docker host
// offers, then serve the internal API and the preview proxy. The only
// component with Docker access, and only through the socket proxy (D7).

const log: Log = (level, message, fields = {}) => {
  const line = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
};

const REAP_EVERY_MS = 60_000;
const DOCKER_RETRY_MS = 5000;

const main = async () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only: values may be secrets.
    log("error", "invalid environment", {
      variables: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
    process.exit(1);
  }
  const env = parsed.data;
  const docker = createDockerodePort(env.DOCKER_HOST);

  // The runner is no use without Docker, so wait for the proxy to come up.
  let runtimes: string[] | undefined;
  while (!runtimes) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: a retry loop; each try waits for the last.
      runtimes = await docker.listRuntimes();
    } catch {
      log("warn", "waiting for the Docker API", {
        dockerHost: env.DOCKER_HOST,
      });
      await sleep(DOCKER_RETRY_MS);
    }
  }
  const choice = selectRuntime(runtimes, env.SANDBOX_RUNTIME);
  if (!choice.ok) {
    log("error", choice.error);
    process.exit(1);
  }
  if (choice.value.warning) {
    log("warn", choice.value.warning);
  }
  if (!env.SANDBOX_RUNNER_TOKEN) {
    log("warn", "SANDBOX_RUNNER_TOKEN is not set; the API refuses every call");
  }

  const previewTemplate = env.SANDBOX_PREVIEW_URL.trim() || null;
  const runner = createRunner({
    config: {
      choice: choice.value,
      defaults: {
        image: env.SANDBOX_IMAGE,
        pidsLimit: env.SANDBOX_PIDS_LIMIT,
        runtime: choice.value.runtime,
        storageQuota: env.SANDBOX_STORAGE_QUOTA,
        tmpMb: env.SANDBOX_TMP_MB,
        user: env.SANDBOX_USER,
      },
      desktopImage: env.SANDBOX_DESKTOP_IMAGE,
      egress: egressPolicy(env),
      idleMs: env.SANDBOX_IDLE_MINUTES * 60_000,
      previewTemplate,
      // Docker sets a container's hostname to its id unless told otherwise.
      runnerContainer: env.RUNNER_CONTAINER ?? hostname(),
    },
    docker,
    log,
  });
  // Before serving: a preview for a sandbox from before the restart must find
  // the runner already back on its network.
  const recovered = await runner.recover();
  if (recovered.ok) {
    log("info", "recovered running sandboxes", {
      count: recovered.value.running,
      rejoined: recovered.value.rejoined,
    });
  }

  const api = serve({
    fetch: createApp({ runner, token: env.SANDBOX_RUNNER_TOKEN }).fetch,
    hostname: env.RUNNER_HOST,
    port: env.RUNNER_PORT,
  });
  const preview = previewTemplate
    ? serve({
        fetch: createPreviewApp({ runner }).fetch,
        hostname: env.RUNNER_HOST,
        port: env.RUNNER_PREVIEW_PORT,
      })
    : null;
  // WebSocket upgrades (dev-server hot reload) skip Hono and arrive here.
  preview?.on("upgrade", createPreviewUpgrade({ runner }));
  log("info", "sandbox-runner listening", {
    isolation: choice.value.isolation,
    port: env.RUNNER_PORT,
    previewPort: preview ? env.RUNNER_PREVIEW_PORT : null,
    runtime: choice.value.runtime,
  });

  const reaper = setInterval(() => {
    runner.reapIdle().then(
      (reaped) => {
        if (reaped.length > 0) {
          log("info", "stopped idle sandboxes", { count: reaped.length });
        }
      },
      () => undefined
    );
  }, REAP_EVERY_MS);
  reaper.unref();

  const shutdown = () => {
    clearInterval(reaper);
    api.close();
    preview?.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
};

main().catch((cause: unknown) => {
  log("error", "sandbox-runner crashed", {
    cause: cause instanceof Error ? cause.message : String(cause),
  });
  process.exit(1);
});
