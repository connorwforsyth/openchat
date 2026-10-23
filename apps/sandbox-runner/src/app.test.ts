import { fixtureId } from "@workspace/contract/fixtures";
import {
  createComputers,
  desktopIdFor,
} from "@workspace/sandbox/computer/computer";
import { createDockerSandboxFactory } from "@workspace/sandbox/docker/client";
import type { Sandbox } from "@workspace/sandbox/ports/sandbox";
import { signRequest } from "@workspace/sandbox/runner/auth";
import { describe, expect, it } from "vitest";

import { createApp, createPreviewApp } from "./app";
import { createMemoryDocker } from "./docker-port.memory";
import { createRunner, type RunnerConfig } from "./runner";
import { SANDBOX_LABEL, selectRuntime } from "./spec";

const id = fixtureId("sandbox", 1);
const conversationId = fixtureId("conversation", 1);
const limits = { cpu: 1, diskMb: 1024, memoryMb: 512, network: false };
// A test value, not a real secret.
const token = "test-runner-token";
const RUNNER = "http://runner.test";
const SNAPSHOT_REF = /^sbx-snap-/;

/** A runner over `fake`; pass the same fake again to "restart" the runner. */
const setup = (
  overrides: Partial<RunnerConfig> = {},
  fake = createMemoryDocker()
) => {
  const choice = selectRuntime(["runc"], "auto");
  if (!choice.ok) {
    throw new Error("no runtime");
  }
  let clock = new Date("2026-09-27T10:00:00Z");
  const now = () => clock;
  const logs: string[] = [];
  const runner = createRunner({
    config: {
      choice: choice.value,
      defaults: {
        image: "node:24-bookworm-slim",
        pidsLimit: 256,
        runtime: choice.value.runtime,
        storageQuota: false,
        tmpMb: 64,
        user: "1000:1000",
      },
      desktopImage: "sandbox-desktop:test",
      egress: { mode: "none" },
      idleMs: 60_000,
      previewTemplate: "http://{id}-{port}.sandbox.localhost:7071",
      runnerContainer: "runner",
      ...overrides,
    },
    docker: fake.docker,
    log: (_level, message) => logs.push(message),
    now,
  });
  const app = createApp({ now, runner, token });
  const factory = createDockerSandboxFactory({
    fetch: async (input, init) => await app.request(String(input), init),
    now,
    runnerUrl: `${RUNNER}/`,
    token,
  });
  return {
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    app,
    factory,
    fake,
    logs,
    now,
    runner,
  };
};

const must = async <T>(
  result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>
): Promise<T> => {
  const settled = await result;
  if (!settled.ok) {
    throw new Error(JSON.stringify(settled.error));
  }
  return settled.value;
};

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("runner API authentication", () => {
  it("serves health without auth and refuses unsigned calls", async () => {
    const { app } = setup();
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/v1/status")).status).toBe(401);
  });

  it("refuses bad signatures, other bodies and stale timestamps", async () => {
    const { app, now } = setup();
    const body = JSON.stringify({ id, limits });
    const headers = await signRequest(
      token,
      { body, method: "POST", path: "/v1/sandboxes" },
      now()
    );
    const tampered = await app.request("/v1/sandboxes", {
      body: JSON.stringify({ id, limits: { ...limits, memoryMb: 99_999 } }),
      headers,
      method: "POST",
    });
    expect(tampered.status).toBe(401);
    const wrongKey = await signRequest(
      "other",
      { body: "", method: "GET", path: "/v1/status" },
      now()
    );
    expect(
      (await app.request("/v1/status", { headers: wrongKey })).status
    ).toBe(401);
    const old = await signRequest(
      token,
      { body: "", method: "GET", path: "/v1/status" },
      new Date(now().getTime() - 3_600_000)
    );
    expect(
      await (await app.request("/v1/status", { headers: old })).json()
    ).toEqual({
      reason: "expired",
    });
  });

  it("is closed, not open, without a token", async () => {
    const fake = createMemoryDocker();
    const choice = selectRuntime([], "auto");
    if (!choice.ok) {
      throw new Error("no runtime");
    }
    const runner = createRunner({
      config: {
        choice: choice.value,
        defaults: {
          image: "x",
          pidsLimit: 16,
          runtime: "runc",
          storageQuota: false,
          tmpMb: 16,
          user: "1000:1000",
        },
        desktopImage: "sandbox-desktop:test",
        egress: { mode: "none" },
        idleMs: 1,
        previewTemplate: null,
        runnerContainer: null,
      },
      docker: fake.docker,
      log: () => undefined,
    });
    const app = createApp({ runner, token: undefined });
    expect((await app.request("/v1/status")).status).toBe(503);
  });
});

describe("runner API validation", () => {
  const signed = async (
    app: ReturnType<typeof setup>["app"],
    now: () => Date,
    method: string,
    path: string,
    body = ""
  ) =>
    app.request(path, {
      body: body || undefined,
      headers: await signRequest(token, { body, method, path }, now()),
      method,
    });

  it("rejects malformed input before it reaches Docker", async () => {
    const { app, fake, now } = setup();
    const cases: [string, string, string][] = [
      ["POST", "/v1/sandboxes", JSON.stringify({ id: "not-a-uuid", limits })],
      [
        "POST",
        "/v1/sandboxes",
        JSON.stringify({ id, limits: { ...limits, cpu: -1 } }),
      ],
      ["POST", "/v1/sandboxes", "{not json"],
      ["POST", `/v1/sandboxes/${id}/exec`, JSON.stringify({ command: "" })],
      ["POST", `/v1/sandboxes/${id}/ports`, JSON.stringify({ port: 70_000 })],
      [
        "PUT",
        `/v1/sandboxes/${id}/file`,
        JSON.stringify({ content: "not base64!", path: "a" }),
      ],
      ["GET", "/v1/sandboxes/nope", ""],
    ];
    for (const [method, path, body] of cases) {
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time keeps failures readable.
      const response = await signed(app, now, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(400);
    }
    expect(fake.created).toEqual([]);
  });

  it("refuses snapshot refs that aren't its own volumes", async () => {
    const { factory, fake } = setup();
    const created = await factory.create({
      conversationId,
      id,
      limits,
      snapshotRef: "postgres-data",
    });
    expect(created).toEqual({
      error: { path: "postgres-data", type: "not_found" },
      ok: false,
    });
    expect(fake.created).toEqual([]);
  });
});

describe("runner through the docker client", () => {
  it("reports its runtime and the runc warning", async () => {
    const { factory } = setup();
    const status = await must(factory.runnerStatus());
    expect(status).toMatchObject({
      egress: "none",
      isolation: "container",
      runtime: "runc",
      sandboxes: 0,
    });
    expect(status.warning).toContain("gVisor");
  });

  it("creates a hardened container, then runs PLAN.md's check", async () => {
    const { factory, fake } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    const main = fake.created.find((spec) => spec.name === `sbx-${id}`);
    expect(main?.HostConfig).toMatchObject({
      CapDrop: ["ALL"],
      NetworkMode: `sbx-${id}`,
      ReadonlyRootfs: true,
      Runtime: "runc",
    });
    expect(fake.pulled).toEqual(["node:24-bookworm-slim"]);
    expect(fake.networks.get(`sbx-${id}`)).toMatchObject({ internal: true });

    const chunks: string[] = [];
    const result = await must(
      sandbox.exec("ls && echo hi > a.txt && cat a.txt", {
        onOutput: (chunk) => chunks.push(chunk.data),
      })
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "hi\n",
      timedOut: false,
    });
    expect(chunks.join("")).toBe("hi\n");
    expect(await must(sandbox.status())).toEqual({ state: "ready" });
  });

  it("reads, writes and lists files, including big ones in chunks", async () => {
    const { factory } = setup();
    const sandbox: Sandbox = await must(
      factory.create({ conversationId, id, limits })
    );
    const big = "x".repeat(300_000);
    await must(sandbox.writeFile("src/big.txt", big));
    await must(sandbox.writeFile("src/app.ts", "export {};\n"));
    expect(decode(await must(sandbox.readFile("src/big.txt")))).toBe(big);
    const listing = await must(sandbox.listFiles(".", { recursive: true }));
    expect(listing.map((entry) => [entry.path, entry.type])).toEqual([
      ["/work/src", "directory"],
      ["/work/src/app.ts", "file"],
      ["/work/src/big.txt", "file"],
    ]);
    expect(await sandbox.readFile("missing.txt")).toEqual({
      error: { path: "missing.txt", type: "not_found" },
      ok: false,
    });
    expect((await sandbox.readFile("../../etc/shadow")).ok).toBe(false);
    expect(await sandbox.listFiles("nope")).toMatchObject({
      error: { type: "not_found" },
    });
  });

  it("reports non-zero exits and stderr as results", async () => {
    const { factory } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    const result = await must(sandbox.exec("echo oops >&2; exit 3"));
    expect(result).toMatchObject({ exitCode: 3, stderr: "oops\n" });
  });

  it("snapshots into a new volume and restores from it", async () => {
    const { factory, fake } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    await must(sandbox.writeFile("keep.txt", "kept"));
    const { ref } = await must(sandbox.snapshot());
    expect(ref).toMatch(SNAPSHOT_REF);
    // The copy runs as the sandbox user, so the new volume is handed over first.
    expect(
      fake.created.some(
        (spec) =>
          spec.User === "0:0" &&
          spec.Cmd?.[0] === "chown" &&
          spec.HostConfig?.Mounts?.[0]?.Source === ref
      )
    ).toBe(true);
    const other = fixtureId("sandbox", 2);
    const restored = await must(
      factory.create({ conversationId, id: other, limits, snapshotRef: ref })
    );
    expect(decode(await must(restored.readFile("keep.txt")))).toBe("kept");
  });

  it("exposes only requested ports through the preview proxy", async () => {
    const { factory, runner } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    const preview = await must(sandbox.exposePort(5173));
    expect(preview.url).toBe(`http://${id}-5173.sandbox.localhost:7071`);

    const seen: string[] = [];
    const proxy = createPreviewApp({
      fetch: (input) => {
        seen.push(String(input));
        return Promise.resolve(new Response("<h1>hi</h1>"));
      },
      runner,
    });
    const ok = await proxy.request("/index.html?x=1", {
      headers: { host: `${id}-5173.sandbox.localhost:7071` },
    });
    expect(await ok.text()).toBe("<h1>hi</h1>");
    expect(seen).toEqual(["http://10.0.0.2:5173/index.html?x=1"]);
    const hidden = await proxy.request("/", {
      headers: { host: `${id}-8080.sandbox.localhost:7071` },
    });
    expect(hidden.status).toBe(404);
  });

  describe("preview CORS", () => {
    const host = `${id}-5173.sandbox.localhost:7071`;
    /** A proxy in front of a dev server that answers with `upstream`'s headers. */
    const proxyWith = async (upstream: Record<string, string> = {}) => {
      const { factory, runner } = setup();
      const sandbox = await must(
        factory.create({ conversationId, id, limits })
      );
      await must(sandbox.exposePort(5173));
      const origins: (string | null)[] = [];
      const proxy = createPreviewApp({
        fetch: (_input, init) => {
          origins.push(new Headers(init?.headers).get("origin"));
          return Promise.resolve(
            new Response("export {};", {
              headers: { "content-type": "text/javascript", ...upstream },
            })
          );
        },
        runner,
      });
      const get = (origin?: string) =>
        proxy.request("/src/main.js", {
          headers: origin ? { host, origin } : { host },
        });
      return { get, origins };
    };

    it("doesn't pass on an encoding fetch has already decoded", async () => {
      // The fake stands in for fetch after it gunzipped the body: the headers
      // still say gzip, the body is plain (ticket 068).
      const { get } = await proxyWith({
        "content-encoding": "gzip",
        "content-length": "12",
      });
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe(null);
      expect(response.headers.get("content-length")).toBe(null);
      expect(await response.text()).toBe("export {};");
    });

    it("lets the panel's opaque-origin iframe load module scripts", async () => {
      const { get, origins } = await proxyWith();
      const response = await get("null");
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("null");
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        null
      );
      expect(response.headers.get("vary")).toBe("Origin");
      // The dev server still sees who asked.
      expect(origins).toEqual(["null"]);
    });

    it("never allows credentials for the null origin", async () => {
      const { get } = await proxyWith({
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": "*",
        vary: "Accept-Encoding",
      });
      const response = await get("null");
      expect(response.headers.get("access-control-allow-origin")).toBe("null");
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        null
      );
      expect(response.headers.get("vary")).toBe("Accept-Encoding, Origin");
    });

    it("leaves every other origin to the dev server", async () => {
      const { get } = await proxyWith();
      for (const origin of ["http://localhost:3000", "https://evil.test"]) {
        // biome-ignore lint/performance/noAwaitInLoops: one request at a time.
        const response = await get(origin);
        expect(response.headers.get("access-control-allow-origin")).toBe(null);
        expect(response.headers.get("vary")).toBe("Origin");
      }
      const plain = await get();
      expect(plain.headers.get("access-control-allow-origin")).toBe(null);
      expect(plain.headers.get("vary")).toBe("Origin");

      const allowed = await proxyWith({
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": "http://localhost:3000",
        vary: "origin",
      });
      const response = await allowed.get("http://localhost:3000");
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:3000"
      );
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        "true"
      );
      expect(response.headers.get("vary")).toBe("origin");
    });
  });

  it("stops idle sandboxes and starts them again on use", async () => {
    const { advance, factory, fake, runner } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    advance(120_000);
    expect(await runner.reapIdle()).toEqual([id]);
    expect(await must(sandbox.status())).toEqual({ state: "stopped" });
    expect(await must(sandbox.exec("echo back"))).toMatchObject({
      stdout: "back\n",
    });
    expect(fake.containers().find((c) => c.name === `sbx-${id}`)?.running).toBe(
      true
    );
  });

  it("destroys the container, network and volume", async () => {
    const { factory, fake } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    await must(sandbox.destroy());
    expect(fake.containers()).toEqual([]);
    expect(fake.volumes.has(`sbx-${id}`)).toBe(false);
    // The runner joined it for previews, and had to leave before removing it.
    expect(fake.networks.has(`sbx-${id}`)).toBe(false);
    expect(await factory.attach(id)).toMatchObject({
      error: { type: "unavailable" },
    });
  });

  it("restarts a sandbox keeping its files, and starts a stopped one", async () => {
    const { advance, factory, fake, runner } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    await must(sandbox.writeFile("notes.txt", "kept"));
    await must(factory.restart(id));
    expect(fake.stops).toEqual([`sbx-${id}`]);
    expect(await must(sandbox.status())).toEqual({ state: "ready" });
    expect(decode(await must(sandbox.readFile("notes.txt")))).toBe("kept");

    advance(120_000);
    await runner.reapIdle();
    await must(factory.restart(id));
    expect(await must(sandbox.status())).toEqual({ state: "ready" });
  });

  it("can't restart a sandbox that doesn't exist", async () => {
    const { factory } = setup();
    expect(await factory.restart(id)).toMatchObject({
      error: { type: "not_found" },
    });
  });

  it("turns a Docker outage into `unavailable`", async () => {
    const { factory, fake, logs } = setup();
    fake.failNext("createVolume");
    expect(await factory.create({ conversationId, id, limits })).toEqual({
      error: {
        message: "the sandbox host couldn't create the sandbox",
        type: "unavailable",
      },
      ok: false,
    });
    expect(logs).toContain("docker: create the sandbox failed");
  });

  it("is unavailable when the runner can't be reached or has no token", async () => {
    const unreachable = createDockerSandboxFactory({
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
      runnerUrl: RUNNER,
      token,
    });
    expect(await unreachable.attach(id)).toEqual({
      error: {
        message: "the sandbox runner is unreachable",
        type: "unavailable",
      },
      ok: false,
    });
    const tokenless = createDockerSandboxFactory({
      runnerUrl: RUNNER,
      token: undefined,
    });
    expect((await tokenless.runnerStatus()).ok).toBe(false);
  });
});

describe("the runner after a restart", () => {
  const host = (sandbox: string, port: number) =>
    `${sandbox}-${port}.sandbox.localhost:7071`;

  /**
   * A dev server in `sandbox`, reachable the way Docker routes: only from a
   * container on the sandbox's own network.
   */
  const devServer =
    (fake: ReturnType<typeof createMemoryDocker>, sandbox: string) => () =>
      fake.networks.get(`sbx-${sandbox}`)?.members.has("runner")
        ? Promise.resolve(new Response("<h1>hi</h1>"))
        : Promise.reject(new TypeError("fetch failed"));

  /** Creates sandboxes, then recreates the runner container and restarts it. */
  const restarted = async (...ids: (typeof id)[]) => {
    const before = setup();
    for (const sandbox of ids) {
      // biome-ignore lint/performance/noAwaitInLoops: one sandbox at a time.
      await must(
        before.factory.create({ conversationId, id: sandbox, limits })
      );
    }
    before.fake.recreate("runner");
    return setup({}, before.fake);
  };

  it("rejoins a sandbox's network on expose, so its preview answers", async () => {
    const { factory, fake, runner } = await restarted(id);
    expect(fake.networks.get(`sbx-${id}`)?.members.has("runner")).toBe(false);
    const proxy = createPreviewApp({ fetch: devServer(fake, id), runner });

    // What the server does on attach (067): expose the recorded ports again.
    const sandbox = await must(factory.attach(id));
    await Promise.all([
      must(sandbox.exposePort(5173)),
      must(sandbox.exposePort(5174)),
    ]);
    const response = await proxy.request("/", {
      headers: { host: host(id, 5173) },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>hi</h1>");

    // One join for both exposes and every request after them.
    await proxy.request("/", { headers: { host: host(id, 5174) } });
    await proxy.request("/", { headers: { host: host(id, 5173) } });
    expect(
      fake.connects.filter((call) => call === `sbx-${id} runner`)
    ).toHaveLength(2); // the create, then the restart's one
  });

  it("rejoins running sandboxes' networks on startup, and only theirs", async () => {
    const stopped = fixtureId("sandbox", 2);
    const stranger = fixtureId("sandbox", 3);
    const { fake, runner } = await restarted(id, stopped);
    await fake.docker.stopContainer(`sbx-${stopped}`);
    // Running and labelled with a sandbox id, but not the runner's.
    await fake.docker.createNetwork({
      Internal: true,
      Labels: {},
      Name: `sbx-${stranger}`,
    });
    await fake.docker.startContainer(
      await fake.docker.createContainer({
        Labels: { [SANDBOX_LABEL]: stranger },
        name: `sbx-${stranger}`,
      })
    );

    expect(await runner.recover()).toEqual({
      ok: true,
      value: { rejoined: 1, running: 1 },
    });
    const members = (sandbox: string) =>
      fake.networks.get(`sbx-${sandbox}`)?.members.has("runner");
    expect(members(id)).toBe(true);
    expect(members(stopped)).toBe(false);
    expect(members(stranger)).toBe(false);
    // Exposed ports aren't restored: the server re-exposes what it recorded.
    expect(await runner.previewTarget(id, 5173)).toBe(null);
  });

  it("says clearly when Docker won't let it join, then tries again", async () => {
    const { factory, fake, logs } = await restarted(id);
    const sandbox = await must(factory.attach(id));
    fake.failNext("connectNetwork");
    expect(await sandbox.exposePort(5173)).toEqual({
      error: {
        message:
          "the sandbox host couldn't reach the sandbox's network, so previews can't load",
        type: "unavailable",
      },
      ok: false,
    });
    expect(logs).toContain("docker: join the sandbox network failed");
    expect((await sandbox.exposePort(5173)).ok).toBe(true);
    expect(fake.networks.get(`sbx-${id}`)?.members.has("runner")).toBe(true);
  });

  it("answers 502 when the sandbox doesn't answer in time", async () => {
    const { factory, runner } = setup();
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    await must(sandbox.exposePort(5173));
    // Like a SYN into a network the runner isn't on: nothing, ever.
    const proxy = createPreviewApp({
      answerTimeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        }),
      runner,
    });
    const response = await proxy.request("/", {
      headers: { host: host(id, 5173) },
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("The preview isn't answering");
  });
});

describe("a Dot's computer on the runner", () => {
  const desktopLimits = { ...limits, network: true };
  const desktop = desktopIdFor(conversationId);

  it("restarts keeping the desktop's files, and starts one if there's none", async () => {
    const { factory, fake } = setup();
    const computers = createComputers({
      host: factory,
      limits: desktopLimits,
      viewReadySeconds: 0,
    });
    const started = await must(computers.restart(conversationId));
    expect(started.holder).toBe("agent");
    const sandbox = await must(factory.attach(desktop));
    await must(sandbox.writeFile("notes.txt", "kept"));

    const view = await must(computers.restart(conversationId));
    expect(view.url).toBe(started.url);
    expect(fake.stops).toContain(`sbx-${desktop}`);
    expect(decode(await must(sandbox.readFile("notes.txt")))).toBe("kept");
  });

  it("resets to a fresh desktop without its files, with or without one", async () => {
    const { factory } = setup();
    const computers = createComputers({
      host: factory,
      limits: desktopLimits,
      viewReadySeconds: 0,
    });
    await must(computers.reset(conversationId));
    const sandbox = await must(factory.attach(desktop));
    await must(sandbox.writeFile("notes.txt", "gone"));

    await must(computers.reset(conversationId));
    expect(await must(sandbox.status())).toEqual({ state: "ready" });
    expect(await sandbox.readFile("notes.txt")).toMatchObject({
      error: { type: "not_found" },
    });
  });
});
