import { once } from "node:events";
import {
  createServer,
  type IncomingHttpHeaders,
  request,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { fixtureId } from "@workspace/contract/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryDocker } from "./docker-port.memory";
import { createPreviewUpgrade } from "./preview-upgrade";
import { createRunner } from "./runner";
import { selectRuntime } from "./spec";

const id = fixtureId("sandbox", 1);
const limits = { cpu: 1, diskMb: 1024, memoryMb: 512, network: false };
const EXPOSED = 5173;
const DEAD = 3000;
const ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
const LOOPBACK_HOST = /^127\.0\.0\.1:\d+$/;

const listen = async (server: Server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
};

const close = (server: Server) => {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
};

interface Seen {
  readonly headers: IncomingHttpHeaders;
  readonly url: string | undefined;
}

type Answer =
  | {
      readonly status: 101;
      readonly headers: IncomingHttpHeaders;
      readonly socket: Duplex;
    }
  | { readonly status: number; readonly body: string };

/** A WebSocket handshake to the preview proxy, as a browser would send it. */
const handshake = (
  port: number,
  host: string,
  { path = "/", upgrade = "websocket" } = {}
) =>
  new Promise<Answer>((resolve, reject) => {
    const req = request({
      headers: {
        connection: "Upgrade",
        host,
        "proxy-authorization": "Basic not-for-the-sandbox",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        upgrade,
      },
      host: "127.0.0.1",
      path,
      port,
    });
    req.on("upgrade", (response, socket) =>
      resolve({ headers: response.headers, socket, status: 101 })
    );
    req.on("response", async (response) => {
      let body = "";
      for await (const chunk of response) {
        body += String(chunk);
      }
      resolve({ body, status: response.statusCode ?? 0 });
    });
    req.on("error", reject);
    req.end();
  });

describe("the preview proxy's WebSocket upgrades", () => {
  let seen: Seen[];
  let upstream: Server;
  let proxy: Server;
  let proxyPort: number;

  beforeEach(async () => {
    seen = [];
    // Stands in for a dev server: accepts the handshake, then echoes bytes.
    upstream = createServer((_req, res) => res.end());
    upstream.on("upgrade", (req, socket: Duplex) => {
      seen.push({ headers: req.headers, url: req.url });
      if (req.url?.startsWith("/refuse")) {
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 4\r\n\r\nnope");
        return;
      }
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${ACCEPT}\r\n\r\n`
      );
      socket.pipe(socket);
    });
    const upstreamPort = await listen(upstream);
    const dead = createServer();
    const deadPort = await listen(dead);
    await close(dead);

    const choice = selectRuntime(["runc"], "auto");
    if (!choice.ok) {
      throw new Error("no runtime");
    }
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
        egressProxyUrl: null,
        idleMs: 60_000,
        previewTemplate: "http://{id}-{port}.sandbox.localhost:7071",
        runnerContainer: "runner",
      },
      docker: createMemoryDocker().docker,
      log: () => undefined,
    });
    const ready = [
      await runner.create({
        egress: { mode: "none" },
        id,
        limits,
        variant: "workspace",
      }),
      await runner.exposePort(id, EXPOSED),
      await runner.exposePort(id, DEAD),
    ];
    if (!ready.every((result) => result.ok)) {
      throw new Error("couldn't set up the sandbox");
    }

    // The real runner decides what's exposed; only the address it answers
    // with (the fake Docker's 10.0.0.2) is moved to loopback.
    const loopback = { [DEAD]: deadPort, [EXPOSED]: upstreamPort };
    proxy = createServer((_req, res) => res.end());
    proxy.on(
      "upgrade",
      createPreviewUpgrade({
        runner: {
          previewTarget: async (sandbox, port) => {
            const target = await runner.previewTarget(sandbox, port);
            const local = loopback[port as keyof typeof loopback];
            return target && local ? `http://127.0.0.1:${local}` : target;
          },
        },
      })
    );
    proxyPort = await listen(proxy);
  });

  afterEach(async () => {
    await close(proxy);
    await close(upstream);
  });

  it("passes an upgrade through to an exposed port, both ways", async () => {
    const answer = await handshake(
      proxyPort,
      `${id}-${EXPOSED}.sandbox.localhost:7071`,
      { path: "/?token=hmr" }
    );
    if (!("socket" in answer)) {
      throw new Error(`expected 101, got ${answer.status}`);
    }
    expect(answer.headers["sec-websocket-accept"]).toBe(ACCEPT);
    answer.socket.write("ping");
    const [echoed] = await once(answer.socket, "data");
    expect(String(echoed)).toBe("ping");
    answer.socket.destroy();

    expect(seen).toHaveLength(1);
    const [first] = seen;
    expect(first?.url).toBe("/?token=hmr");
    // The same header rules as HTTP previews: the sandbox sees its own
    // address as the host, and no proxy credentials.
    expect(first?.headers.host).toMatch(LOOPBACK_HOST);
    expect(first?.headers["proxy-authorization"]).toBeUndefined();
    expect(first?.headers["sec-websocket-key"]).toBe(
      "dGhlIHNhbXBsZSBub25jZQ=="
    );
  });

  it("refuses an upgrade to a port the sandbox didn't expose", async () => {
    const answer = await handshake(
      proxyPort,
      `${id}-8080.sandbox.localhost:7071`
    );
    expect(answer).toEqual({ body: "Not found", status: 404 });
    expect(seen).toEqual([]);
  });

  it("refuses other sandboxes, other hosts and other protocols", async () => {
    const other = fixtureId("sandbox", 2);
    for (const host of [
      `${other}-${EXPOSED}.sandbox.localhost:7071`,
      "localhost:7071",
      "10.0.0.2:5173",
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one refusal at a time.
      expect(await handshake(proxyPort, host)).toMatchObject({ status: 404 });
    }
    const host = `${id}-${EXPOSED}.sandbox.localhost:7071`;
    expect(await handshake(proxyPort, host, { upgrade: "h2c" })).toMatchObject({
      status: 400,
    });
    expect(seen).toEqual([]);
  });

  it("passes the dev server's refusal on", async () => {
    const answer = await handshake(
      proxyPort,
      `${id}-${EXPOSED}.sandbox.localhost:7071`,
      { path: "/refuse" }
    );
    expect(answer).toEqual({ body: "nope", status: 403 });
  });

  it("answers 502 when nothing listens on the exposed port", async () => {
    const answer = await handshake(
      proxyPort,
      `${id}-${DEAD}.sandbox.localhost:7071`
    );
    expect(answer).toEqual({
      body: "The preview isn't answering",
      status: 502,
    });
  });
});
