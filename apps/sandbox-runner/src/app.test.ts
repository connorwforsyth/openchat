import { fixtureId } from "@workspace/contract/fixtures";
import { createDockerSandboxFactory } from "@workspace/sandbox/docker/client";
import type { Sandbox } from "@workspace/sandbox/ports/sandbox";
import { signRequest } from "@workspace/sandbox/runner/auth";
import { describe, expect, it } from "vitest";

import { createApp, createPreviewApp } from "./app";
import { createMemoryDocker } from "./docker-port.memory";
import { createRunner, type RunnerConfig } from "./runner";
import { selectRuntime } from "./spec";

const id = fixtureId("sandbox", 1);
const conversationId = fixtureId("conversation", 1);
const limits = { cpu: 1, diskMb: 1024, memoryMb: 512, network: false };
// A test value, not a real secret.
const token = "test-runner-token";
const RUNNER = "http://runner.test";
const SNAPSHOT_REF = /^sbx-snap-/;

const setup = (overrides: Partial<RunnerConfig> = {}) => {
  const fake = createMemoryDocker();
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
