import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { serve } from "@hono/node-server";

import { createApp, createPreviewApp, createWaitingApp } from "./app";
import { createDockerodePort } from "./dockerode";
import { createEgressProxy } from "./egress-proxy";
import { envSchema } from "./env";
import { createPreviewUpgrade } from "./preview-upgrade";
import { createRunner, type Log } from "./runner";
import { selectRuntime } from "./spec";

// The imperative shell: read the environment, serve the internal API at
// once (answering `docker_unavailable` until Docker does), find out what the
// Docker host offers, then serve sandboxes, the preview proxy and the egress
// proxy. The only component with Docker access, and only through the socket
// proxy (D7).

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
  if (!env.SANDBOX_RUNNER_TOKEN) {
    log("warn", "SANDBOX_RUNNER_TOKEN is not set; the API refuses every call");
  }

  // Up before Docker, so `web` hears why nothing works rather than nothing.
  let serving = createWaitingApp({ token: env.SANDBOX_RUNNER_TOKEN });
  const api = serve({
    fetch: (request) => serving.fetch(request),
    hostname: env.RUNNER_HOST,
    port: env.RUNNER_PORT,
  });

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

  // Docker sets a container's hostname to its id unless told otherwise.
  const runnerContainer = env.RUNNER_CONTAINER ?? hostname();
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
      // Sandboxes find the runner by its container name on their network.
      egressProxyUrl: `http://${runnerContainer}:${env.RUNNER_EGRESS_PROXY_PORT}`,
      idleMs: env.SANDBOX_IDLE_MINUTES * 60_000,
      previewTemplate,
      runnerContainer,
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

  serving = createApp({ runner, token: env.SANDBOX_RUNNER_TOKEN });
  const preview = previewTemplate
    ? serve({
        fetch: createPreviewApp({ runner }).fetch,
        hostname: env.RUNNER_HOST,
        port: env.RUNNER_PREVIEW_PORT,
      })
    : null;
  // WebSocket upgrades (dev-server hot reload) skip Hono and arrive here.
  preview?.on("upgrade", createPreviewUpgrade({ runner }));
  const egress = createEgressProxy({
    allowFor: runner.egressAllowFor,
    log,
  }).listen(env.RUNNER_EGRESS_PROXY_PORT, env.RUNNER_HOST);
  log("info", "sandbox-runner listening", {
    egressProxyPort: env.RUNNER_EGRESS_PROXY_PORT,
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
    egress.close();
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
