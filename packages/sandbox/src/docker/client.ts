import type { SandboxId } from "@workspace/contract/schemas/common";
import type { ExecResult } from "@workspace/contract/schemas/sandbox";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
  tryCatch,
} from "@workspace/shared/result";
import type { z } from "zod";

import type {
  ExecOptions,
  Sandbox,
  SandboxError,
  SandboxFactory,
} from "../ports/sandbox";
import { signRequest } from "../runner/auth";
import {
  type ExecEvent,
  errorResponseSchema,
  execEventSchema,
  exposePortResponseSchema,
  fileContentSchema,
  fromBase64,
  listFilesResponseSchema,
  type RunnerStatus,
  runnerPaths,
  runnerStatusSchema,
  sandboxStateResponseSchema,
  snapshotResponseSchema,
  toBase64,
} from "../runner/protocol";

// The `docker` provider as `web` sees it: a client for `sandbox-runner`'s
// signed internal API (D7). `web` never talks to Docker itself and never
// gets the socket (D24); everything goes through the runner. A runner that's
// down or unconfigured is `unavailable`, never a crash.

export interface DockerClientOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** e.g. `http://sandbox-runner:7070` (config `sandbox.docker.runnerUrl`). */
  readonly runnerUrl: string;
  /** The shared secret; without it every call is `unavailable`. */
  readonly token: string | undefined;
}

export interface DockerSandboxFactory extends SandboxFactory {
  /** The runner's runtime and isolation, for the panel and the admin warning. */
  readonly runnerStatus: () => AsyncResult<RunnerStatus, SandboxError>;
}

const unavailable = (message: string): SandboxError => ({
  message,
  type: "unavailable",
});

const TRAILING_SLASHES = /\/+$/;

const parseLine = (line: string): ExecEvent | null => {
  const json = tryCatch(
    () => JSON.parse(line) as unknown,
    () => null
  );
  const event = json.ok ? execEventSchema.safeParse(json.value) : null;
  return event?.success ? event.data : null;
};

/** Handles complete NDJSON lines; returns the outcome once one arrives. */
const settle = (
  lines: readonly string[],
  onOutput: ExecOptions["onOutput"]
): Result<ExecResult, SandboxError> | undefined => {
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const event = parseLine(line);
    if (!event) {
      return err(unavailable("the sandbox runner sent an unexpected event"));
    }
    switch (event.type) {
      case "output":
        onOutput?.({ data: event.data, stream: event.stream });
        break;
      case "exit":
        return ok(event.result);
      case "error":
        return err(event.error);
      default:
        return event satisfies never;
    }
  }
};

/** Follows `exec`'s NDJSON stream to its `exit` or `error` event. */
const readExecStream = async (
  body: NonNullable<Response["body"]>,
  onOutput: ExecOptions["onOutput"]
): AsyncResult<ExecResult, SandboxError> => {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  try {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: a stream is read one chunk at a time.
      const chunk = await reader.read();
      buffered += chunk.value ?? "";
      const lines = buffered.split("\n");
      buffered = chunk.done ? "" : (lines.pop() ?? "");
      const outcome = settle(lines, onOutput);
      if (outcome) {
        return outcome;
      }
      if (chunk.done) {
        return err(unavailable("the command's output ended early"));
      }
    }
  } catch {
    return err(unavailable("the command's output was interrupted"));
  } finally {
    reader.releaseLock();
  }
};

export const createDockerSandboxFactory = ({
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  runnerUrl,
  token,
}: DockerClientOptions): DockerSandboxFactory => {
  const base = runnerUrl.replace(TRAILING_SLASHES, "");

  const send = async (
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ): AsyncResult<Response, SandboxError> => {
    if (!token) {
      return err(unavailable("the sandbox runner token is not configured"));
    }
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers = {
      ...(await signRequest(token, { body: payload, method, path }, now())),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    };
    try {
      const response = await fetchImpl(`${base}${path}`, {
        body: body === undefined ? undefined : payload,
        headers,
        method,
        signal,
      });
      if (response.ok) {
        return ok(response);
      }
      const parsed = errorResponseSchema.safeParse(
        await response.json().catch(() => null)
      );
      return err(
        parsed.success
          ? parsed.data.error
          : unavailable(`the sandbox runner answered ${response.status}`)
      );
    } catch {
      // Never echo the URL or the cause: they can carry internal hostnames.
      return err(unavailable("the sandbox runner is unreachable"));
    }
  };

  const call = async <S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown
  ): AsyncResult<z.infer<S>, SandboxError> => {
    const response = await send(method, path, body);
    if (!response.ok) {
      return response;
    }
    const parsed = schema.safeParse(
      await response.value.json().catch(() => null)
    );
    return parsed.success
      ? ok(parsed.data)
      : err(unavailable("the sandbox runner sent an unexpected response"));
  };

  const callVoid = async (
    method: string,
    path: string,
    body?: unknown
  ): AsyncResult<void, SandboxError> => {
    const response = await send(method, path, body);
    return response.ok ? ok(undefined) : response;
  };

  const exec = async (
    id: SandboxId,
    command: string,
    options: ExecOptions
  ): AsyncResult<ExecResult, SandboxError> => {
    const response = await send(
      "POST",
      runnerPaths.exec(id),
      {
        command,
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
      },
      options.signal
    );
    if (!response.ok) {
      return response;
    }
    const { body } = response.value;
    return body
      ? readExecStream(body, options.onOutput)
      : err(unavailable("the sandbox runner sent no output"));
  };

  const handle = (id: SandboxId): Sandbox => ({
    destroy: () => callVoid("DELETE", runnerPaths.sandbox(id)),
    exec: (command, options = {}) => exec(id, command, options),
    exposePort: (port) =>
      call(exposePortResponseSchema, "POST", runnerPaths.ports(id), { port }),
    id,
    listFiles: async (path, options = {}) => {
      const query = new URLSearchParams({
        path,
        recursive: String(options.recursive ?? false),
      });
      const listed = await call(
        listFilesResponseSchema,
        "GET",
        `${runnerPaths.files(id)}?${query}`
      );
      return listed.ok ? ok(listed.value.entries) : listed;
    },
    provider: "docker",
    readFile: async (path) => {
      const query = new URLSearchParams({ path });
      const read = await call(
        fileContentSchema,
        "GET",
        `${runnerPaths.file(id)}?${query}`
      );
      return read.ok ? ok(fromBase64(read.value.content)) : read;
    },
    snapshot: () =>
      call(snapshotResponseSchema, "POST", runnerPaths.snapshot(id)),
    status: async () => {
      const state = await call(
        sandboxStateResponseSchema,
        "GET",
        runnerPaths.sandbox(id)
      );
      return state.ok ? ok(state.value.status) : state;
    },
    writeFile: (path, content) =>
      callVoid("PUT", runnerPaths.file(id), {
        content: toBase64(
          typeof content === "string"
            ? new TextEncoder().encode(content)
            : content
        ),
        path,
      }),
  });

  return {
    attach: async (id) => {
      const state = await call(
        sandboxStateResponseSchema,
        "GET",
        runnerPaths.sandbox(id)
      );
      if (!state.ok) {
        return err(
          state.error.type === "not_found"
            ? unavailable(`the runner has no sandbox ${id}`)
            : state.error
        );
      }
      return state.value.status.state === "destroyed"
        ? err({ type: "destroyed" })
        : ok(handle(id));
    },
    create: async (spec) => {
      const created = await call(
        sandboxStateResponseSchema,
        "POST",
        runnerPaths.sandboxes,
        {
          id: spec.id,
          limits: spec.limits,
          snapshotRef: spec.snapshotRef,
        }
      );
      return created.ok ? ok(handle(spec.id)) : created;
    },
    provider: "docker",
    runnerStatus: () => call(runnerStatusSchema, "GET", runnerPaths.status),
  };
};
