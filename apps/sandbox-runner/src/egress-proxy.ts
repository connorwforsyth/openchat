import {
  createServer,
  request as forward,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";

import { hostAllowed } from "@workspace/sandbox/runner/egress";

import type { Log } from "./runner";

// The egress proxy for `allowlist` sandboxes (D7). They sit on an internal
// network with no route out; the runner is on that network too, and this
// forward proxy is their only way to the internet: CONNECT for HTTPS,
// absolute-URI requests for plain HTTP. Who is asking is the source address,
// which a sandbox can't forge (every capability is dropped), and each
// sandbox's list comes from its own labels. Anything else is refused.

export interface EgressTarget {
  readonly host: string;
  readonly port: number;
}

const AUTHORITY = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/;
const MAPPED_V4 = /^::ffff:/;

/** `host:port` from a CONNECT line; `null` if it isn't one. Pure. */
export const parseAuthority = (authority: string): EgressTarget | null => {
  const match = AUTHORITY.exec(authority);
  const port = Number(match?.[2]);
  return match?.[1] && port >= 1 && port <= 65_535
    ? { host: match[1], port }
    : null;
};

/** Whether a sandbox with `allow` (`null`: not an allowlist sandbox) may reach `target`. Pure. */
export const egressAllowed = (
  allow: readonly string[] | null,
  target: EgressTarget,
  ports: readonly number[]
): boolean =>
  allow !== null &&
  ports.includes(target.port) &&
  hostAllowed(target.host, allow);

/** The peer's IPv4 address as Docker reports it, without the v6 mapping. */
export const peerAddress = (address: string | undefined): string =>
  (address ?? "").replace(MAPPED_V4, "");

export interface EgressProxyDeps {
  readonly allowFor: (ip: string) => Promise<readonly string[] | null>;
  readonly log: Log;
  /** Ports a sandbox may reach on an allowed host. */
  readonly ports?: readonly number[];
}

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const withoutHopByHop = (headers: IncomingHttpHeaders) => {
  const nominated = (headers.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase());
  const excluded = new Set([...HOP_BY_HOP, ...nominated]);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !excluded.has(name.toLowerCase())
    )
  );
};

const refusal = (target: EgressTarget) =>
  `${target.host}:${target.port} isn't on this sandbox's egress allowlist (sandbox.egress.allow in app.config.yaml)\n`;

export const createEgressProxy = ({
  allowFor,
  log,
  ports = [80, 443],
}: EgressProxyDeps): Server => {
  const decide = async (request: IncomingMessage, target: EgressTarget) => {
    const ip = peerAddress(request.socket.remoteAddress);
    const allowed = egressAllowed(await allowFor(ip), target, ports);
    if (!allowed) {
      log("info", "egress refused", {
        host: target.host,
        ip,
        port: target.port,
      });
    }
    return allowed;
  };

  // Plain HTTP: the request line carries the whole URL.
  const server = createServer(async (request, response) => {
    const url = URL.canParse(request.url ?? "")
      ? new URL(request.url ?? "")
      : null;
    if (url?.protocol !== "http:") {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("This is a forward proxy: send an absolute http:// URL.\n");
      return;
    }
    const target = { host: url.hostname, port: Number(url.port || 80) };
    if (!(await decide(request, target))) {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end(refusal(target));
      return;
    }
    const upstream = forward(
      {
        headers: { ...withoutHopByHop(request.headers), host: url.host },
        host: target.host,
        method: request.method,
        path: `${url.pathname}${url.search}`,
        port: target.port,
      },
      (answer) => {
        response.writeHead(
          answer.statusCode ?? 502,
          withoutHopByHop(answer.headers)
        );
        answer.pipe(response);
      }
    );
    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }
      response.end();
    });
    request.pipe(upstream);
  });

  // HTTPS: a tunnel to the host, opened only if it's on the list.
  server.on(
    "connect",
    async (request: IncomingMessage, client: Duplex, head: Buffer) => {
      client.on("error", () => client.destroy());
      const target = parseAuthority(request.url ?? "");
      if (!target) {
        client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      if (!(await decide(request, target))) {
        client.end(
          `HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${refusal(target)}`
        );
        return;
      }
      let open = false;
      const upstream = connect(target.port, target.host, () => {
        open = true;
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => {
        if (open) {
          client.destroy();
        } else {
          client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        }
      });
      client.on("close", () => upstream.destroy());
    }
  );
  return server;
};
