import { once } from "node:events";
import {
  createServer,
  type IncomingHttpHeaders,
  request,
  type Server,
} from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createEgressProxy,
  egressAllowed,
  parseAuthority,
  peerAddress,
} from "./egress-proxy";

describe("parseAuthority", () => {
  it("reads host and port from a CONNECT line", () => {
    expect(parseAuthority("registry.npmjs.org:443")).toEqual({
      host: "registry.npmjs.org",
      port: 443,
    });
  });

  it("refuses anything that isn't host:port", () => {
    expect(parseAuthority("registry.npmjs.org")).toBe(null);
    expect(parseAuthority("http://pypi.org:443")).toBe(null);
    expect(parseAuthority("pypi.org:99999")).toBe(null);
  });
});

describe("egressAllowed", () => {
  const target = { host: "pypi.org", port: 443 };

  it("allows a listed host on an allowed port", () => {
    expect(egressAllowed(["pypi.org"], target, [443])).toBe(true);
  });

  it("refuses other ports, unlisted hosts and unknown sandboxes", () => {
    expect(egressAllowed(["pypi.org"], { ...target, port: 22 }, [443])).toBe(
      false
    );
    expect(egressAllowed(["github.com"], target, [443])).toBe(false);
    expect(egressAllowed(null, target, [443])).toBe(false);
  });
});

it("strips the IPv4-mapped prefix from a peer address", () => {
  expect(peerAddress("::ffff:172.18.0.2")).toBe("172.18.0.2");
  expect(peerAddress(undefined)).toBe("");
});

// Everything below stays on 127.0.0.1: an upstream, and the proxy in front.
describe("the egress proxy", () => {
  let upstream: Server;
  let echo: ReturnType<typeof createTcpServer>;
  let proxy: Server;
  let upstreamPort = 0;
  let echoPort = 0;
  let proxyPort = 0;
  const asked: string[] = [];

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url === "/headers") {
        res.writeHead(200, {
          connection: "close, X-Response-Private",
          "keep-alive": "timeout=1234",
          "proxy-authenticate": "private",
          "proxy-authorization": "private",
          "proxy-connection": "private",
          te: "trailers",
          trailer: "X-Response-Trailer",
          upgrade: "private",
          "x-response-private": "private",
          "x-response-public": "preserved",
        });
        res.end(JSON.stringify(req.headers));
        return;
      }
      res.end("upstream says hi");
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    upstreamPort = (upstream.address() as AddressInfo).port;
    echo = createTcpServer((socket) => socket.pipe(socket));
    echo.listen(0, "127.0.0.1");
    await once(echo, "listening");
    echoPort = (echo.address() as AddressInfo).port;
    proxy = createEgressProxy({
      allowFor: (ip) => {
        asked.push(ip);
        return Promise.resolve(["localhost"]);
      },
      log: () => undefined,
      ports: [upstreamPort, echoPort],
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(() => {
    for (const server of [upstream, echo, proxy]) {
      server.close();
    }
  });

  const tunnel = (authority: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const connectRequest = request({
        host: "127.0.0.1",
        method: "CONNECT",
        path: authority,
        port: proxyPort,
      });
      connectRequest.on("connect", (response, socket) => {
        if (response.statusCode !== 200) {
          resolve({ body: "", status: response.statusCode ?? 0 });
          socket.destroy();
          return;
        }
        socket.write("ping");
        socket.once("data", (data) => {
          resolve({ body: data.toString(), status: 200 });
          socket.destroy();
        });
      });
      connectRequest.on("error", reject);
      connectRequest.end();
    });

  const get = (url: string, headers?: IncomingHttpHeaders) =>
    new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>(
      (resolve, reject) => {
        const getRequest = request(
          { headers, host: "127.0.0.1", path: url, port: proxyPort },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () =>
              resolve({
                body,
                headers: response.headers,
                status: response.statusCode ?? 0,
              })
            );
          }
        );
        getRequest.on("error", reject);
        getRequest.end();
      }
    );

  it("tunnels HTTPS to a listed host, asking by the sandbox's address", async () => {
    expect(await tunnel(`localhost:${echoPort}`)).toEqual({
      body: "ping",
      status: 200,
    });
    expect(asked.at(-1)).toBe("127.0.0.1");
  });

  it("refuses a tunnel to a host that isn't listed", async () => {
    expect((await tunnel(`127.0.0.1:${echoPort}`)).status).toBe(403);
    expect((await tunnel("example.com:443")).status).toBe(403);
  });

  it("forwards plain HTTP to a listed host, and refuses the rest", async () => {
    expect(await get(`http://localhost:${upstreamPort}/`)).toMatchObject({
      body: "upstream says hi",
      status: 200,
    });
    const refused = await get(`http://example.com:${upstreamPort}/`);
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("isn't on this sandbox's egress allowlist");
  });

  it("uses the allowlisted URL authority instead of the client's Host", async () => {
    const response = await get(`http://localhost:${upstreamPort}/headers`, {
      host: "unlisted.example",
    });
    expect(JSON.parse(response.body).host).toBe(`localhost:${upstreamPort}`);
  });

  it("removes hop-by-hop and Connection-nominated request headers", async () => {
    const response = await get(`http://localhost:${upstreamPort}/headers`, {
      connection: "close, X-Request-Private, X-Second-Private",
      "keep-alive": "timeout=1234",
      "proxy-authenticate": "private",
      "proxy-authorization": "private",
      "proxy-connection": "private",
      te: "trailers",
      trailer: "X-Request-Trailer",
      "transfer-encoding": "chunked",
      upgrade: "private",
      "x-request-private": "private",
      "x-request-public": "preserved",
      "x-second-private": "private",
    });
    const headers = JSON.parse(response.body);
    for (const name of [
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "proxy-connection",
      "te",
      "trailer",
      "upgrade",
      "x-request-private",
      "x-second-private",
    ]) {
      expect(headers[name], name).toBeUndefined();
    }
    expect(headers.connection).not.toContain("X-Request-Private");
    expect(headers["x-request-public"]).toBe("preserved");
  });

  it("removes hop-by-hop and Connection-nominated response headers", async () => {
    const { body, headers, status } = await get(
      `http://localhost:${upstreamPort}/headers`
    );
    expect(status).toBe(200);
    expect(JSON.parse(body)).toHaveProperty("host");
    for (const name of [
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "proxy-connection",
      "te",
      "trailer",
      "upgrade",
      "x-response-private",
    ]) {
      expect(headers[name], name).toBeUndefined();
    }
    expect(headers.connection).not.toContain("X-Response-Private");
    expect(headers["x-response-public"]).toBe("preserved");
  });

  it("isn't a web server: a relative request is a bad request", async () => {
    expect((await get("/")).status).toBe(400);
  });
});
