import { sandboxIdSchema } from "@workspace/contract/schemas/common";
import type { SandboxError } from "@workspace/sandbox/ports/sandbox";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyRequest,
} from "@workspace/sandbox/runner/auth";
import {
  createRequestSchema,
  type ExecEvent,
  execRequestSchema,
  exposePortRequestSchema,
  listFilesQuerySchema,
  RUNNER_API_PREFIX,
  readFileQuerySchema,
  writeFileRequestSchema,
} from "@workspace/sandbox/runner/protocol";
import { type Result, tryCatch } from "@workspace/shared/result";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import type { Runner } from "./runner";
import { parsePreviewHost } from "./spec";

// The runner's HTTP API (the internal one `web` calls, see
// `@workspace/sandbox/runner/protocol`) and the preview proxy. The API is
// HMAC-authenticated; without a configured secret it refuses everything
// rather than running open. Input is zod-parsed before it reaches the runner.

const STATUS: Readonly<Record<SandboxError["type"], ContentfulStatusCode>> = {
  destroyed: 410,
  invalid_path: 400,
  limit_exceeded: 413,
  not_found: 404,
  unavailable: 503,
  unsupported: 501,
};

interface Env {
  Variables: { body: string };
}

export interface AppOptions {
  readonly now?: () => Date;
  readonly runner: Runner;
  /** The shared secret; `undefined` means the API is closed. */
  readonly token: string | undefined;
}

export const createApp = ({
  now = () => new Date(),
  runner,
  token,
}: AppOptions) => {
  const app = new Hono<Env>();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.use(`${RUNNER_API_PREFIX}/*`, async (c, next) => {
    if (!token) {
      return c.json(
        {
          error: {
            message: "the runner has no SANDBOX_RUNNER_TOKEN configured",
            type: "unavailable",
          },
        },
        503
      );
    }
    const body = await c.req.text();
    const url = new URL(c.req.url);
    const verified = await verifyRequest(
      token,
      {
        body,
        method: c.req.method,
        path: `${url.pathname}${url.search}`,
        signature: c.req.header(SIGNATURE_HEADER),
        timestamp: c.req.header(TIMESTAMP_HEADER),
      },
      now()
    );
    if (!verified.ok) {
      return c.json({ reason: verified.error }, 401);
    }
    c.set("body", body);
    await next();
  });

  const parseId = (value: string | undefined) =>
    sandboxIdSchema.safeParse(value);

  /** Parses a JSON body; `undefined` when it doesn't fit the schema. */
  const parseBody = <S extends z.ZodType>(
    body: string,
    schema: S
  ): z.infer<S> | undefined => {
    const json = tryCatch(
      () => (body ? JSON.parse(body) : {}) as unknown,
      () => undefined
    );
    const parsed = json.ok ? schema.safeParse(json.value) : undefined;
    return parsed?.success ? parsed.data : undefined;
  };

  const reply = <T>(
    c: { json: (value: unknown, status?: ContentfulStatusCode) => Response },
    result: Result<T, SandboxError>,
    shape: (value: T) => unknown
  ) =>
    result.ok
      ? c.json(shape(result.value))
      : c.json({ error: result.error }, STATUS[result.error.type]);

  const badRequest = (c: {
    json: (value: unknown, status: ContentfulStatusCode) => Response;
  }) => c.json({ reason: "invalid request" }, 400);

  const api = new Hono<Env>();

  api.get("/status", (c) => c.json(runner.status()));

  api.post("/sandboxes", async (c) => {
    const request = parseBody(c.get("body"), createRequestSchema);
    if (!request) {
      return badRequest(c);
    }
    return reply(c, await runner.create(request), (status) => ({
      id: request.id,
      status,
    }));
  });

  api.get("/sandboxes/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.success) {
      return badRequest(c);
    }
    return reply(c, await runner.state(id.data), (status) => ({
      id: id.data,
      status,
    }));
  });

  api.delete("/sandboxes/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.success) {
      return badRequest(c);
    }
    const destroyed = await runner.destroy(id.data);
    return destroyed.ok
      ? c.body(null, 204)
      : c.json({ error: destroyed.error }, STATUS[destroyed.error.type]);
  });

  api.post("/sandboxes/:id/exec", (c) => {
    const id = parseId(c.req.param("id"));
    const request = parseBody(c.get("body"), execRequestSchema);
    if (!(id.success && request)) {
      return badRequest(c);
    }
    const encoder = new TextEncoder();
    const abort = new AbortController();
    // NDJSON: output events as they happen, then exactly one `exit` or `error`.
    const body = new ReadableStream<Uint8Array>({
      cancel: () => abort.abort(),
      start: async (controller) => {
        const send = (event: ExecEvent) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const result = await runner.exec(
          id.data,
          request,
          (stream, data) => send({ data, stream, type: "output" }),
          abort.signal
        );
        send(
          result.ok
            ? { result: result.value, type: "exit" }
            : { error: result.error, type: "error" }
        );
        controller.close();
      },
    });
    return new Response(body, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson",
      },
    });
  });

  api.get("/sandboxes/:id/files", async (c) => {
    const id = parseId(c.req.param("id"));
    const query = listFilesQuerySchema.safeParse(c.req.query());
    if (!(id.success && query.success)) {
      return badRequest(c);
    }
    return reply(
      c,
      await runner.listFiles(id.data, query.data.path, query.data.recursive),
      (entries) => ({ entries })
    );
  });

  api.get("/sandboxes/:id/file", async (c) => {
    const id = parseId(c.req.param("id"));
    const query = readFileQuerySchema.safeParse(c.req.query());
    if (!(id.success && query.success)) {
      return badRequest(c);
    }
    return reply(
      c,
      await runner.readFile(id.data, query.data.path),
      (content) => ({
        content,
      })
    );
  });

  api.put("/sandboxes/:id/file", async (c) => {
    const id = parseId(c.req.param("id"));
    const request = parseBody(c.get("body"), writeFileRequestSchema);
    if (!(id.success && request)) {
      return badRequest(c);
    }
    const written = await runner.writeFile(
      id.data,
      request.path,
      request.content
    );
    return written.ok
      ? c.body(null, 204)
      : c.json({ error: written.error }, STATUS[written.error.type]);
  });

  api.post("/sandboxes/:id/ports", async (c) => {
    const id = parseId(c.req.param("id"));
    const request = parseBody(c.get("body"), exposePortRequestSchema);
    if (!(id.success && request)) {
      return badRequest(c);
    }
    return reply(
      c,
      await runner.exposePort(id.data, request.port),
      (preview) => preview
    );
  });

  api.post("/sandboxes/:id/snapshot", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.success) {
      return badRequest(c);
    }
    return reply(c, await runner.snapshot(id.data), (snapshot) => snapshot);
  });

  app.route(RUNNER_API_PREFIX, api);
  return app;
};

/** Hop-by-hop headers a proxy must not forward. */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
];

/**
 * The preview proxy: `{id}-{port}.<preview domain>` → the sandbox's port.
 * It listens on its own port and hostname, a separate origin from the app
 * (D24), and forwards only ports the sandbox explicitly exposed. Plain HTTP
 * only for now: no WebSocket upgrades, so dev-server hot reload won't work.
 */
export const createPreviewApp = ({
  fetch: fetchImpl = globalThis.fetch,
  runner,
}: {
  readonly fetch?: typeof fetch;
  readonly runner: Pick<Runner, "previewTarget">;
}) => {
  const app = new Hono();
  app.all("*", async (c) => {
    const target = parsePreviewHost(c.req.header("host") ?? "");
    const id = sandboxIdSchema.safeParse(target?.id);
    if (!(target && id.success)) {
      return c.text("Not found", 404);
    }
    const upstream = await runner.previewTarget(id.data, target.port);
    if (!upstream) {
      return c.text("Not found", 404);
    }
    const url = new URL(c.req.url);
    const headers = new Headers(c.req.raw.headers);
    for (const name of HOP_BY_HOP) {
      headers.delete(name);
    }
    try {
      const response = await fetchImpl(
        `${upstream}${url.pathname}${url.search}`,
        {
          body: ["GET", "HEAD"].includes(c.req.method)
            ? undefined
            : c.req.raw.body,
          headers,
          method: c.req.method,
          redirect: "manual",
          // Needed by Node's fetch to stream a request body.
          ...({ duplex: "half" } as object),
        }
      );
      const out = new Headers(response.headers);
      for (const name of HOP_BY_HOP) {
        out.delete(name);
      }
      return new Response(response.body, {
        headers: out,
        status: response.status,
      });
    } catch {
      return c.text("The preview isn't answering", 502);
    }
  });
  return app;
};
