import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type FetchPolicy,
  type Resolve,
  type SafeFetchDeps,
  safeFetch,
} from "./safe-fetch";

// The fetcher's SSRF guards (101), against servers on loopback. Loopback is
// itself refused, so each test allowlists exactly the fixture's origin (the
// test-only escape hatch the fetcher takes as an argument) and checks that
// everything else stays refused. Nothing here touches the real network: names
// resolve through a fake, and a test that expects a refusal fails if a
// connection is attempted.

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

const serve = async (handler: Handler) => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, port, server };
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

const HTML: FetchPolicy = {
  accept: (type) => type === "text/html",
  acceptHeader: "text/html",
  maxBytes: 1024 * 1024,
  overflow: "truncate",
  stopAt: "</head>",
};

const IMAGE: FetchPolicy = {
  accept: (type) => type.startsWith("image/") && type !== "image/svg+xml",
  acceptHeader: "image/*",
  maxBytes: 2 * 1024 * 1024,
  overflow: "refuse",
};

/** Resolves only the names given; anything else is a test bug. */
const fakeDns = (answers: Record<string, readonly string[]>): Resolve =>
  vi.fn((hostname: string) => {
    const found = answers[hostname];
    if (!found) {
      return Promise.reject(new Error(`unexpected lookup of ${hostname}`));
    }
    return Promise.resolve(
      found.map((address) => ({
        address,
        family: address.includes(":") ? (6 as const) : (4 as const),
      }))
    );
  });

const deps = (overrides: Partial<SafeFetchDeps> = {}): SafeFetchDeps => ({
  allowOrigins: new Set(),
  resolve: fakeDns({}),
  timeoutMs: 5000,
  ...overrides,
});

const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("safeFetch refuses private destinations", () => {
  it.each([
    ["localhost", "http://localhost/", { localhost: ["127.0.0.1", "::1"] }],
    ["a loopback literal", "http://127.0.0.1/", {}],
    ["an IPv6 loopback literal", "http://[::1]/", {}],
    ["an IPv4-mapped literal", "http://[::ffff:127.0.0.1]/", {}],
    ["the metadata address", "http://169.254.169.254/latest/meta-data/", {}],
    ["a decimal loopback", "http://2130706433/", {}],
    [
      "a public name resolving to 10.0.0.5",
      "https://intranet.example.test/",
      { "intranet.example.test": ["10.0.0.5"] },
    ],
    [
      "a name with one private answer among public ones",
      "https://mixed.example.test/",
      { "mixed.example.test": ["93.184.216.34", "192.168.0.10"] },
    ],
    [
      "a name resolving to the metadata address over IPv6",
      "https://meta.example.test/",
      { "meta.example.test": ["::ffff:169.254.169.254"] },
    ],
  ])("%s", async (_name, url, answers) => {
    const result = await safeFetch(
      url,
      HTML,
      deps({ resolve: fakeDns(answers) })
    );
    expect(result).toEqual({
      error: expect.objectContaining({ type: "blocked" }),
      ok: false,
    });
  });

  it.each([
    "ftp://example.test/file",
    "file:///etc/passwd",
    "data:text/html,<title>x</title>",
    "javascript:alert(1)",
    "gopher://example.test/",
  ])("refuses the scheme of %s", async (url) => {
    const resolve = fakeDns({});
    const result = await safeFetch(url, HTML, deps({ resolve }));
    expect(result).toMatchObject({ error: { type: "blocked" }, ok: false });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses credentials in the URL and non-default ports", async () => {
    const resolve = fakeDns({ "example.test": ["93.184.216.34"] });
    const results = await Promise.all(
      [
        "https://user:pass@example.test/",
        "http://example.test:6379/",
        "https://example.test:8443/",
      ].map((url) => safeFetch(url, HTML, deps({ resolve })))
    );
    for (const result of results) {
      expect(result).toMatchObject({ error: { type: "blocked" }, ok: false });
    }
  });

  it("refuses a loopback fixture unless its exact origin is allowlisted", async () => {
    let hits = 0;
    const fixture = await serve((_request, response) => {
      hits += 1;
      response.setHeader("content-type", "text/html");
      response.end(page("<title>Hi</title>"));
    });
    const refused = await safeFetch(`${fixture.origin}/`, HTML, deps());
    expect(refused).toMatchObject({ error: { type: "blocked" }, ok: false });
    const otherPort = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set(["http://127.0.0.1:1"]) })
    );
    expect(otherPort).toMatchObject({ error: { type: "blocked" }, ok: false });
    expect(hits).toBe(0);

    const allowed = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(allowed.ok).toBe(true);
    expect(hits).toBe(1);
  });
});

describe("safeFetch redirects", () => {
  it("re-checks every hop: a redirect to a private address is refused", async () => {
    let privateHits = 0;
    const internal = await serve((_request, response) => {
      privateHits += 1;
      response.end("secret");
    });
    const fixture = await serve((request, response) => {
      const to =
        request.url === "/to-ten"
          ? "http://10.0.0.5/admin"
          : `${internal.origin}/`;
      response.writeHead(302, { location: to });
      response.end();
    });
    const allowOrigins = new Set([fixture.origin]);
    const results = await Promise.all(
      ["/to-ten", "/to-loopback"].map((path) =>
        safeFetch(`${fixture.origin}${path}`, HTML, deps({ allowOrigins }))
      )
    );
    for (const result of results) {
      expect(result).toMatchObject({ error: { type: "blocked" }, ok: false });
    }
    expect(privateHits).toBe(0);
  });

  it("follows at most three redirects", async () => {
    const fixture = await serve((request, response) => {
      const hop = Number(request.url?.slice(1) ?? 0);
      if (hop > 0) {
        response.writeHead(301, { location: `/${hop - 1}` });
        response.end();
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(page("<title>Landed</title>"));
    });
    const options = deps({ allowOrigins: new Set([fixture.origin]) });
    const three = await safeFetch(`${fixture.origin}/3`, HTML, options);
    expect(three.ok && three.value.finalUrl.pathname).toBe("/0");
    const four = await safeFetch(`${fixture.origin}/4`, HTML, options);
    expect(four).toMatchObject({
      error: { type: "too_many_redirects" },
      ok: false,
    });
  });

  it("resolves each hop's name and pins the connection to the checked address", async () => {
    // `pinned.test` has no real DNS entry: if the HTTP client looked it up
    // itself instead of using the checked answer, the request would fail.
    const fixture = await serve((request, response) => {
      if (request.url === "/start") {
        response.writeHead(302, {
          location: `http://second.test:${fixture.port}/end`,
        });
        response.end();
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(page(`<title>${request.headers.host}</title>`));
    });
    const resolve = fakeDns({
      "pinned.test": ["127.0.0.1"],
      "second.test": ["127.0.0.1"],
    });
    const result = await safeFetch(
      `http://pinned.test:${fixture.port}/start`,
      HTML,
      deps({
        allowOrigins: new Set([
          `http://pinned.test:${fixture.port}`,
          `http://second.test:${fixture.port}`,
        ]),
        resolve,
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.value.body)).toContain(
        `<title>second.test:${fixture.port}</title>`
      );
    }
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenNthCalledWith(1, "pinned.test");
    expect(resolve).toHaveBeenNthCalledWith(2, "second.test");
  });

  it("connects to the address it checked, even if the name rebinds", async () => {
    // DNS rebinding: the first answer passes the check, later ones point
    // inside. Only one lookup may happen per hop, and the socket must go to
    // its answer; a second lookup here would send it to 10.0.0.5 and fail.
    const fixture = await serve((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(page("<title>Pinned</title>"));
    });
    const answers = ["127.0.0.1"];
    const resolve: Resolve = vi.fn(() =>
      Promise.resolve([
        { address: answers.shift() ?? "10.0.0.5", family: 4 as const },
      ])
    );
    const result = await safeFetch(
      `http://rebind.test:${fixture.port}/`,
      HTML,
      deps({
        allowOrigins: new Set([`http://rebind.test:${fixture.port}`]),
        resolve,
        timeoutMs: 2000,
      })
    );
    expect(result.ok).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("safeFetch limits", () => {
  it("refuses a response that isn't HTML", async () => {
    const fixture = await serve((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(result).toMatchObject({
      error: { contentType: "application/json", type: "unsupported_type" },
      ok: false,
    });
  });

  it("refuses an error status", async () => {
    const fixture = await serve((_request, response) => {
      response.writeHead(500, { "content-type": "text/html" });
      response.end("boom");
    });
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(result).toMatchObject({
      error: { status: 500, type: "http_status" },
      ok: false,
    });
  });

  it("reads at most 1 MB of an oversize HTML body", async () => {
    let written = 0;
    let closed = false;
    const fixture = await serve((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.write("<html><head><title>Big</title>");
      const chunk = `<meta name="x" content="${"a".repeat(64 * 1024)}">`;
      const pump = () => {
        while (written < 8 * 1024 * 1024) {
          written += chunk.length;
          if (!response.write(chunk)) {
            response.once("drain", pump);
            return;
          }
        }
        response.end();
      };
      response.on("close", () => {
        closed = true;
      });
      pump();
    });
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body.byteLength).toBeLessThanOrEqual(1024 * 1024);
      expect(result.value.truncated).toBe(true);
    }
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(written).toBeLessThan(8 * 1024 * 1024);
  });

  it("stops reading at </head>", async () => {
    const fixture = await serve((_request, response) => {
      response.setHeader("content-type", "text/html");
      // The body never ends: the fetcher must not wait for it.
      response.write(page("<title>Early</title>").replace("</html>", ""));
    });
    const started = Date.now();
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]), timeoutMs: 3000 })
    );
    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses an oversize image, by its declared length or as it streams", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    const fixture = await serve((request, response) => {
      response.setHeader("content-type", "image/png");
      if (request.url === "/declared") {
        response.setHeader("content-length", String(big.length));
      }
      response.end(big);
    });
    const options = deps({ allowOrigins: new Set([fixture.origin]) });
    const results = await Promise.all(
      ["/declared", "/streamed"].map((path) =>
        safeFetch(`${fixture.origin}${path}`, IMAGE, options)
      )
    );
    for (const result of results) {
      expect(result).toMatchObject({ error: { type: "too_large" }, ok: false });
    }
  });

  it("refuses SVG under the image policy", async () => {
    const fixture = await serve((_request, response) => {
      response.setHeader("content-type", "image/svg+xml");
      response.end("<svg onload='alert(1)'/>");
    });
    const result = await safeFetch(
      `${fixture.origin}/`,
      IMAGE,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(result).toMatchObject({
      error: { type: "unsupported_type" },
      ok: false,
    });
  });

  it("times out a server that never answers", async () => {
    const fixture = await serve(() => {
      // Never responds.
    });
    const started = Date.now();
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]), timeoutMs: 300 })
    );
    expect(result).toMatchObject({ error: { type: "timeout" }, ok: false });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out a body that trickles in, within the same deadline", async () => {
    const fixture = await serve((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.write("<html><head>");
      const drip = setInterval(() => response.write(" "), 50);
      response.on("close", () => clearInterval(drip));
    });
    const started = Date.now();
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]), timeoutMs: 400 })
    );
    expect(result).toMatchObject({ error: { type: "timeout" }, ok: false });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("decodes a gzipped body, capping the decoded bytes", async () => {
    const fixture = await serve((_request, response) => {
      response.writeHead(200, {
        "content-encoding": "gzip",
        "content-type": "text/html",
      });
      response.end(gzipSync(page("<title>Zipped</title>")));
    });
    const result = await safeFetch(
      `${fixture.origin}/`,
      HTML,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(result.ok && new TextDecoder().decode(result.value.body)).toContain(
      "<title>Zipped</title>"
    );
  });

  it("caps a gzip bomb by its decoded size", async () => {
    const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024, 0x61));
    const fixture = await serve((_request, response) => {
      response.writeHead(200, {
        "content-encoding": "gzip",
        "content-type": "image/png",
      });
      response.end(bomb);
    });
    const result = await safeFetch(
      `${fixture.origin}/`,
      IMAGE,
      deps({ allowOrigins: new Set([fixture.origin]) })
    );
    expect(result).toMatchObject({ error: { type: "too_large" }, ok: false });
  });
});
