// A smoke test for a real sandbox-runner on a real Docker host (ticket 029,
// PLAN.md §11 step 6 for Docker). It drives the runner's signed API through
// `@workspace/sandbox`'s docker provider, the same client `web` uses, so both
// ends of the protocol are exercised. Docker itself is only read, through the
// CLI, to check what the runner left behind.
//
//   SANDBOX_RUNNER_TOKEN=… EXPECT_RUNTIME=runc bun apps/sandbox-runner/test/e2e/smoke.ts
//
// Expects `docker compose --profile sandbox up` to be running, the runner's
// API and preview ports published on this host, and `docker` on the PATH.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import type { SandboxId } from "@workspace/contract/schemas/common";
import { createDockerSandboxFactory } from "@workspace/sandbox/docker/client";
import type { Sandbox, SandboxError } from "@workspace/sandbox/ports/sandbox";
import {
  ensureStaticPreview,
  STATIC_PREVIEW_PORT,
} from "@workspace/sandbox/tools/static-preview";
import { newId } from "@workspace/shared/ids";
import type { Result } from "@workspace/shared/result";
import { z } from "zod";

const envSchema = z.object({
  EXPECT_RUNTIME: z.enum(["runc", "runsc"]),
  RUNNER_URL: z.url().default("http://127.0.0.1:7070"),
  SANDBOX_RUNNER_TOKEN: z.string().min(1),
});

const PREVIEW_PORT = 3000;
const PREVIEW_BODY = "hello from the sandbox";
const PREVIEW_ATTEMPTS = 30;
const limits = { cpu: 1, diskMb: null, memoryMb: 512, network: false };

const PREVIEW_ECHO = "hot reload";

const STATIC_PAGE =
  '<!doctype html><link rel="stylesheet" href="style.css"><h1>static</h1>\n';
const STATIC_CSS = "h1 { color: rebeccapurple; }\n";
// A module script, served like a dev server serves one: no CORS headers of
// its own, which is what Vite does for an origin it doesn't know.
const MODULE_PATH = "/main.js";
const MODULE_BODY = "export const ready = true;\n";

// `npm create` without the internet (the sandbox's default egress is
// `none`): an initializer package, and a registry on the sandbox's loopback
// that serves it. It takes npm's real route, installing into ~/.npm/_npx
// and running the bin from there, which a noexec $HOME refuses (ticket 047).
const REGISTRY_PORT = 4873;
const INITIALIZER = {
  "create-smoke/index.js": `#!/usr/bin/env node
const fs = require("node:fs");
fs.mkdirSync(process.argv[2]);
fs.writeFileSync(process.argv[2] + "/made-by", process.argv[1] + "\\n");
`,
  "create-smoke/package.json": JSON.stringify({
    bin: { "create-smoke": "index.js" },
    name: "create-smoke",
    version: "1.0.0",
  }),
  "registry.js": `const fs = require("node:fs");
const { createHash } = require("node:crypto");
const file = "create-smoke-1.0.0.tgz";
const tarball = fs.readFileSync("/tmp/" + file);
const base = "http://127.0.0.1:${REGISTRY_PORT}";
const manifest = {
  bin: { "create-smoke": "index.js" },
  dist: {
    integrity: "sha512-" + createHash("sha512").update(tarball).digest("base64"),
    shasum: createHash("sha1").update(tarball).digest("hex"),
    tarball: base + "/" + file,
  },
  name: "create-smoke",
  version: "1.0.0",
};
const packument = {
  "dist-tags": { latest: "1.0.0" },
  name: "create-smoke",
  versions: { "1.0.0": manifest },
};
require("node:http")
  .createServer((req, res) => {
    if (req.url === "/create-smoke") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(packument));
    } else if (req.url === "/" + file) {
      res.end(tarball);
    } else {
      res.statusCode = 404;
      res.end();
    }
  })
  .listen(${REGISTRY_PORT}, "127.0.0.1");
`,
};

// The server the preview step starts; plain Node, so the image needs nothing
// extra. It also echoes WebSocket messages, the way a dev server's hot reload
// talks to the page. The image has no `ws`, so the protocol is by hand, and
// only as much of it as the smoke sends: short masked frames, echoed back
// unmasked with the same opcode (a close is answered with a close).
const SERVER = `const { createHash } = require("node:crypto");
const server = require("node:http").createServer((req, res) => {
  if (req.url === "${MODULE_PATH}") {
    res.setHeader("content-type", "text/javascript");
    res.end(${JSON.stringify(MODULE_BODY)});
    return;
  }
  res.end(${JSON.stringify(PREVIEW_BODY)});
});
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
      "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n"
  );
  socket.on("data", (frame) => {
    const length = frame[1] & 0x7f;
    const mask = frame.subarray(2, 6);
    const payload = frame.subarray(6, 6 + length).map((byte, i) => byte ^ mask[i % 4]);
    socket.write(Buffer.concat([Buffer.from([0x80 | (frame[0] & 0x0f), length]), payload]));
  });
  socket.on("error", () => socket.destroy());
});
server.listen(${PREVIEW_PORT}, "0.0.0.0");
`;

/** A failed check. Thrown, and caught once in `main`, like any test assertion. */
const fail = (message: string): never => {
  throw new Error(message);
};

const check = (condition: boolean, message: string) => {
  if (!condition) {
    fail(message);
  }
};

const describeError = (error: SandboxError) =>
  "message" in error
    ? `${error.type}: ${error.message}`
    : JSON.stringify(error);

const must = async <T>(
  step: string,
  result: Promise<Result<T, SandboxError>>
): Promise<T> => {
  const settled = await result;
  return settled.ok
    ? settled.value
    : fail(`${step}: ${describeError(settled.error)}`);
};

const log = (message: string) => console.log(`smoke: ${message}`);

/** `docker …` on this host; `null` when it exits non-zero. */
const docker = (...args: string[]): string | null => {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const run = (sandbox: Sandbox, command: string) =>
  must(`exec \`${command}\``, sandbox.exec(command, { timeoutMs: 60_000 }));

/** Runs `command` and requires exit 0 and exactly `stdout`. */
const expectOutput = async (
  sandbox: Sandbox,
  command: string,
  stdout: string
) => {
  const result = await run(sandbox, command);
  check(
    result.exitCode === 0,
    `\`${command}\` exited ${result.exitCode}: ${result.stderr.trim()}`
  );
  check(
    result.stdout === stdout,
    `\`${command}\` printed ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(stdout)}`
  );
};

/**
 * Fetches a preview URL through the runner's preview proxy. `*.localhost`
 * doesn't resolve everywhere, so connect to loopback on the URL's port and
 * send the preview hostname as `Host`, which is all the proxy routes on.
 */
const fetchPreview = (url: string, headers: Record<string, string> = {}) => {
  const parsed = new URL(url);
  return fetch(`http://127.0.0.1:${parsed.port}${parsed.pathname}`, {
    headers: { ...headers, host: parsed.host },
    signal: AbortSignal.timeout(5000),
  });
};

const waitForPreview = async (url: string): Promise<string> => {
  let last = "no answer";
  for (let attempt = 0; attempt < PREVIEW_ATTEMPTS; attempt += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: polling until the server is up.
      const response = await fetchPreview(url);
      const body = await response.text();
      if (response.ok) {
        return body;
      }
      last = `${response.status} ${body.trim()}`;
    } catch (cause) {
      last = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(1000);
  }
  return fail(`the preview at ${url} never answered: ${last}`);
};

/** Bun's WebSocket takes headers; the DOM typings in scope don't know that. */
const HeadedWebSocket = WebSocket as unknown as new (
  url: string,
  init: { readonly headers: Record<string, string> }
) => WebSocket;

/**
 * Sends one WebSocket message through a preview URL and returns the reply;
 * `null` when the upgrade is refused or nothing comes back. Bun's WebSocket
 * takes a `Host` header, which is what the proxy routes on (see above).
 */
const echoThroughPreview = (url: string, message: string) =>
  new Promise<string | null>((resolve) => {
    const parsed = new URL(url);
    const socket = new HeadedWebSocket(`ws://127.0.0.1:${parsed.port}/`, {
      headers: { host: parsed.host },
    });
    const settle = (reply: string | null) => {
      clearTimeout(timer);
      socket.close();
      resolve(reply);
    };
    const timer = setTimeout(() => settle(null), 5000);
    socket.addEventListener("open", () => socket.send(message));
    socket.addEventListener("message", (event) => settle(String(event.data)));
    socket.addEventListener("error", () => settle(null));
    socket.addEventListener("close", () => settle(null));
  });

/** Everything Docker still has for a sandbox, by kind. */
const leftovers = (id: SandboxId) => {
  const name = `sbx-${id}`;
  return [
    docker("container", "inspect", name) === null ? null : "container",
    docker("volume", "inspect", name) === null ? null : "volume",
    docker("network", "inspect", name) === null ? null : "network",
  ].filter((kind) => kind !== null);
};

const main = async () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only: the token is a secret.
    return fail(
      `missing or invalid environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  }
  const env = parsed.data;
  const factory = createDockerSandboxFactory({
    runnerUrl: env.RUNNER_URL,
    token: env.SANDBOX_RUNNER_TOKEN,
  });
  const conversationId = newId("conversation");
  const created: SandboxId[] = [];
  const snapshots: string[] = [];

  try {
    const status = await must("GET /v1/status", factory.runnerStatus());
    log(`runner reports ${JSON.stringify(status)}`);
    check(
      status.runtime === env.EXPECT_RUNTIME,
      `the runner uses ${status.runtime}, expected ${env.EXPECT_RUNTIME}`
    );
    if (env.EXPECT_RUNTIME === "runsc") {
      check(status.isolation === "gvisor", "runsc should report gvisor");
      check(status.warning === null, "runsc should carry no warning");
    } else {
      check(status.isolation === "container", "runc should report container");
      check(Boolean(status.warning), "runc should carry the admin-UI warning");
    }

    const id = newId("sandbox");
    created.push(id);
    log(`creating sandbox ${id}`);
    const sandbox = await must(
      "create",
      factory.create({ conversationId, id, limits })
    );
    const state = await must("status", sandbox.status());
    check(state.state === "ready", `the new sandbox is ${state.state}`);
    check(
      docker("inspect", "-f", "{{.HostConfig.Runtime}}", `sbx-${id}`) ===
        env.EXPECT_RUNTIME,
      `the sandbox container doesn't run under ${env.EXPECT_RUNTIME}`
    );

    log("exec");
    const node = await run(sandbox, "node -v && echo hi > a.txt && cat a.txt");
    check(
      node.exitCode === 0,
      `exec exited ${node.exitCode}: ${node.stderr.trim()}`
    );
    const [version, hi] = node.stdout.trim().split("\n");
    check(
      Boolean(version?.startsWith("v")) && hi === "hi",
      `unexpected exec output ${JSON.stringify(node.stdout)}`
    );
    const failing = await run(sandbox, "echo oops >&2; exit 3");
    check(
      failing.exitCode === 3 && failing.stderr.trim() === "oops",
      `a failing command came back as ${JSON.stringify(failing)}`
    );

    log("hardening");
    await expectOutput(sandbox, "id -u", "1000\n");
    await expectOutput(
      sandbox,
      "touch /rootfs-probe 2>/dev/null && echo writable || echo read-only",
      "read-only\n"
    );
    // Default egress is `none`: the sandbox network is internal.
    await expectOutput(
      sandbox,
      `node -e 'fetch("http://1.1.1.1", { signal: AbortSignal.timeout(3000) }).then(() => console.log("online"), () => console.log("offline"))'`,
      "offline\n"
    );

    log("npx and npm create");
    for (const [path, content] of Object.entries(INITIALIZER)) {
      // biome-ignore lint/performance/noAwaitInLoops: a few small files.
      await must(`writeFile ${path}`, sandbox.writeFile(path, content));
    }
    const registry = await run(
      sandbox,
      "npm pack ./create-smoke --pack-destination /tmp --silent > /dev/null && " +
        "nohup node registry.js > /tmp/registry.log 2>&1 < /dev/null &"
    );
    check(registry.exitCode === 0, "couldn't start the local registry");
    const npm = `npm_config_registry=http://127.0.0.1:${REGISTRY_PORT} npm_config_update_notifier=false`;
    const scaffolded = await run(
      sandbox,
      `for i in $(seq 1 20); do node -e 'fetch("http://127.0.0.1:${REGISTRY_PORT}/create-smoke").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' && break; sleep 0.5; done; ` +
        `${npm} npm create --yes smoke from-create > /dev/null && cat from-create/made-by && ` +
        `${npm} npx --yes create-smoke from-npx > /dev/null && cat from-npx/made-by`
    );
    const bins = scaffolded.stdout.trim().split("\n");
    check(
      scaffolded.exitCode === 0 &&
        bins.length === 2 &&
        bins.every((bin) => bin.startsWith("/home/sandbox/.npm/_npx/")),
      `npm create and npx exited ${scaffolded.exitCode}: ${JSON.stringify(scaffolded.stdout)} ${scaffolded.stderr.trim()}`
    );
    await expectOutput(
      sandbox,
      "printf '#!/bin/sh\\necho ran\\n' > /tmp/probe && chmod +x /tmp/probe && /tmp/probe",
      "ran\n"
    );

    log("files");
    await must("writeFile", sandbox.writeFile("server.js", SERVER));
    const read = new TextDecoder().decode(
      await must("readFile", sandbox.readFile("server.js"))
    );
    check(read === SERVER, "readFile returned something other than written");
    const files = await must("listFiles", sandbox.listFiles("."));
    const names = files.map((entry) => entry.path);
    check(
      ["a.txt", "server.js"].every((name) =>
        names.some((path) => path.endsWith(`/${name}`))
      ),
      `listFiles returned ${JSON.stringify(names)}`
    );

    log("preview");
    // Detached from the exec's streams, so the call returns while it runs.
    const started = await run(
      sandbox,
      "nohup node server.js > /tmp/server.log 2>&1 < /dev/null &"
    );
    check(started.exitCode === 0, "couldn't start the preview server");
    const preview = await must("exposePort", sandbox.exposePort(PREVIEW_PORT));
    const body = await waitForPreview(preview.url);
    check(
      body === PREVIEW_BODY,
      `the preview answered ${JSON.stringify(body)}`
    );
    const unexposed = await fetchPreview(
      preview.url.replace(`-${PREVIEW_PORT}.`, `-${PREVIEW_PORT + 1}.`)
    );
    check(
      unexposed.status === 404,
      `an unexposed port answered ${unexposed.status}, expected 404`
    );
    // The panel's iframe has an opaque origin (no allow-same-origin), so a
    // dev server's module scripts are cross-origin requests from `null`.
    const script = await fetchPreview(`${preview.url}${MODULE_PATH}`, {
      origin: "null",
    });
    const scriptBody = await script.text();
    check(
      script.ok &&
        scriptBody === MODULE_BODY &&
        script.headers.get("access-control-allow-origin") === "null" &&
        !script.headers.has("access-control-allow-credentials"),
      `a module script for the null origin came back ${script.status} with Access-Control-Allow-Origin ${script.headers.get("access-control-allow-origin") ?? "absent"}`
    );
    const foreign = await fetchPreview(`${preview.url}${MODULE_PATH}`, {
      origin: "https://elsewhere.test",
    });
    await foreign.body?.cancel();
    check(
      !foreign.headers.has("access-control-allow-origin"),
      "the preview proxy allowed an origin the dev server didn't"
    );
    const echoed = await echoThroughPreview(preview.url, PREVIEW_ECHO);
    check(
      echoed === PREVIEW_ECHO,
      `a WebSocket through the preview echoed ${JSON.stringify(echoed)}`
    );
    const refused = await echoThroughPreview(
      preview.url.replace(`-${PREVIEW_PORT}.`, `-${PREVIEW_PORT + 1}.`),
      PREVIEW_ECHO
    );
    check(refused === null, "a WebSocket to an unexposed port was let through");

    log("static preview");
    // 067: a page with no server of the agent's own, served from /work by
    // the built-in static server on its reserved port.
    await must("writeFile", sandbox.writeFile("site/index.html", STATIC_PAGE));
    await must("writeFile", sandbox.writeFile("site/style.css", STATIC_CSS));
    const staticPreview = await ensureStaticPreview(sandbox);
    const exposedStatic = staticPreview.ok
      ? staticPreview.value
      : fail(`ensureStaticPreview: ${staticPreview.error}`);
    check(
      exposedStatic?.port === STATIC_PREVIEW_PORT,
      `the static preview came back as ${JSON.stringify(exposedStatic)}`
    );
    const staticUrl = exposedStatic?.url ?? "";
    const page = await waitForPreview(`${staticUrl}/site/`);
    check(
      page === STATIC_PAGE,
      `the static preview answered ${JSON.stringify(page)}`
    );
    const css = await fetchPreview(`${staticUrl}/site/style.css`);
    check(
      css.ok &&
        (await css.text()) === STATIC_CSS &&
        css.headers.get("content-type") === "text/css; charset=utf-8",
      `style.css came back ${css.status} as ${css.headers.get("content-type")}`
    );
    const climbed = await fetchPreview(`${staticUrl}/%2e%2e/etc/passwd`);
    check(
      climbed.status === 404,
      `a path out of /work answered ${climbed.status}, expected 404`
    );
    await climbed.body?.cancel();
    // Idempotent: a second call finds the server listening and starts none.
    const again = await ensureStaticPreview(sandbox);
    check(
      again.ok && again.value?.url === staticUrl,
      "a second ensureStaticPreview didn't reuse the running server"
    );
    await expectOutput(
      sandbox,
      "pgrep -fc static-preview.mjs || ps -eo args | grep -c '[s]tatic-preview.mjs'",
      "1\n"
    );
    const inWork = await must(
      "listFiles",
      sandbox.listFiles(".", { recursive: true })
    );
    check(
      !inWork.some((entry) => entry.path.includes("static-preview")),
      "the static preview's script landed in /work"
    );

    log("snapshot and restore");
    const snapshot = await must("snapshot", sandbox.snapshot());
    snapshots.push(snapshot.ref);
    const restoredId = newId("sandbox");
    created.push(restoredId);
    const restored = await must(
      "create from snapshot",
      factory.create({
        conversationId,
        id: restoredId,
        limits,
        snapshotRef: snapshot.ref,
      })
    );
    await expectOutput(restored, "cat a.txt", "hi\n");

    log("destroy");
    for (const sandboxId of [id, restoredId]) {
      // biome-ignore lint/performance/noAwaitInLoops: one at a time keeps failures readable.
      const attached = await must("attach", factory.attach(sandboxId));
      await must(`destroy ${sandboxId}`, attached.destroy());
      const left = leftovers(sandboxId);
      check(
        left.length === 0,
        `destroy left the sandbox's ${left.join(", ")} behind`
      );
    }
    const gone = await factory.attach(id);
    check(!gone.ok, "a destroyed sandbox can still be attached");
    log("passed");
  } finally {
    // Best effort, so a failed run doesn't leave the next step a mess.
    for (const sandboxId of created) {
      // biome-ignore lint/performance/noAwaitInLoops: cleanup, in order.
      await factory
        .attach(sandboxId)
        .then((attached) =>
          attached.ok ? attached.value.destroy() : undefined
        );
    }
    for (const ref of snapshots) {
      docker("volume", "rm", "-f", ref);
    }
  }
};

main().catch((cause: unknown) => {
  console.error(
    `smoke: FAILED: ${cause instanceof Error ? cause.message : String(cause)}`
  );
  process.exit(1);
});
