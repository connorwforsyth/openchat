import { type IncomingMessage, request, STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";

import { sandboxIdSchema } from "@workspace/contract/schemas/common";
import { fromPromise, tryCatch } from "@workspace/shared/result";

import type { Runner } from "./runner";
import { parsePreviewHost } from "./spec";

// WebSocket upgrades through the preview proxy, so a dev server's hot reload
// (Vite HMR) works in a preview. Node hands upgrade requests to the server's
// `upgrade` event, never to the Hono app, so this is plain node:http. The
// routing is the HTTP proxy's: the Host header names the sandbox and port,
// and the only address ever dialled is `runner.previewTarget`'s, a port the
// sandbox exposed, on the sandbox's own network. Anything else is refused
// before a connection is opened.

/** Hop-by-hop headers; `connection` and `upgrade` are set again for the handshake. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/** How long the sandbox has to answer the handshake. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** A response head from Node's already-parsed (so CR/LF-free) raw headers. */
const responseHead = (
  status: number,
  message: string | undefined,
  rawHeaders: readonly string[]
) => {
  const lines = [`HTTP/1.1 ${status} ${message ?? STATUS_CODES[status] ?? ""}`];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    lines.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
};

const refuse = (socket: Duplex, status: 400 | 404 | 502, text: string) => {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    `${responseHead(status, undefined, [
      "Connection",
      "close",
      "Content-Type",
      "text/plain; charset=utf-8",
      "Content-Length",
      String(Buffer.byteLength(text)),
    ])}${text}`
  );
};

/** Pipes both ways until either side closes, then closes the other. */
const tunnel = (client: Duplex, upstream: Duplex) => {
  upstream.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
};

/** The request headers to send upstream: the client's, minus hop-by-hop. */
const upstreamHeaders = (req: IncomingMessage, upgrade: string) => {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) {
      headers[name] = value;
    }
  }
  // No `host`: Node sets it to the sandbox's address, as fetch does for HTTP.
  return { ...headers, connection: "Upgrade", upgrade };
};

export type UpgradeListener = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
) => void;

/** The preview server's `upgrade` listener. */
export const createPreviewUpgrade = ({
  handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
  runner,
}: {
  readonly handshakeTimeoutMs?: number;
  readonly runner: Pick<Runner, "previewTarget">;
}): UpgradeListener => {
  const proxy = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upgrade = req.headers.upgrade ?? "";
    // Origin-form only: the path is sent as is, and never picks the address.
    if (upgrade.toLowerCase() !== "websocket" || !req.url?.startsWith("/")) {
      refuse(socket, 400, "Bad request");
      return;
    }
    const target = parsePreviewHost(req.headers.host ?? "");
    const id = sandboxIdSchema.safeParse(target?.id);
    const found =
      target && id.success
        ? await fromPromise(
            runner.previewTarget(id.data, target.port),
            () => null
          )
        : null;
    const upstream = found?.ok ? found.value : null;
    if (!upstream) {
      refuse(socket, 404, "Not found");
      return;
    }
    if (socket.destroyed) {
      return;
    }
    const address = new URL(upstream);
    const opened = tryCatch(
      () =>
        request({
          agent: false,
          headers: upstreamHeaders(req, upgrade),
          host: address.hostname,
          method: "GET",
          path: req.url,
          port: address.port,
        }),
      () => null
    );
    if (!opened.ok) {
      refuse(socket, 400, "Bad request");
      return;
    }
    const proxied = opened.value;
    let answered = false;
    const timer = setTimeout(
      () => proxied.destroy(new Error("the handshake timed out")),
      handshakeTimeoutMs
    );
    const answer = () => {
      answered = true;
      clearTimeout(timer);
    };
    socket.once("close", () => {
      if (!answered) {
        clearTimeout(timer);
        proxied.destroy(new Error("the client went away"));
      }
    });

    proxied.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      answer();
      if (socket.destroyed) {
        upstreamSocket.destroy();
        return;
      }
      socket.write(
        responseHead(101, response.statusMessage, response.rawHeaders)
      );
      if (upstreamHead.length > 0) {
        socket.write(upstreamHead);
      }
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      tunnel(socket, upstreamSocket);
    });

    // The dev server said no (Vite answers 400 to a bad token, say): pass
    // its answer on, then close, since the connection can't be reused.
    proxied.on("response", (response) => {
      answer();
      const kept: string[] = [];
      for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
        const name = response.rawHeaders[index] ?? "";
        if (
          !HOP_BY_HOP.has(name.toLowerCase()) &&
          name.toLowerCase() !== "content-length"
        ) {
          kept.push(name, response.rawHeaders[index + 1] ?? "");
        }
      }
      socket.write(
        responseHead(response.statusCode ?? 502, response.statusMessage, [
          ...kept,
          "Connection",
          "close",
        ])
      );
      response.on("error", () => socket.destroy());
      response.pipe(socket);
    });

    proxied.on("error", () => {
      if (answered) {
        socket.destroy();
        return;
      }
      answer();
      refuse(socket, 502, "The preview isn't answering");
    });
    proxied.end();
  };

  return (req, socket, head) => {
    // An unhandled socket error would take the whole runner down.
    socket.on("error", () => socket.destroy());
    proxy(req, socket, head).catch(() => socket.destroy());
  };
};
