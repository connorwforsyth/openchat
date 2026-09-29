import type { SandboxId } from "@workspace/contract/schemas/common";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import { WORKDIR } from "../paths";
import type { Sandbox, SandboxError } from "../ports/sandbox";
import { waitForListener } from "./listener";
import { STATIC_PREVIEW_SERVER } from "./static-preview-server";

// Static pages preview without a server of the agent's own (067). When an
// `.html` file lands in a workspace that can serve ports, a small file
// server (`static-preview-server.ts`) is started inside the sandbox on a
// reserved port, serving `/work`, and that port is exposed and recorded
// like any preview, so the panel's browser (066) can open the page at its
// path. just-bash has no ports; the panel renders the file itself there.
//
// Everything here is best effort: a write or save never fails because the
// preview couldn't start. The server isn't kept alive by anything: an idle
// stop ends it, and the next `.html` write starts it again.

/**
 * The static preview's port. Not 4173 (`vite preview`'s default) or any
 * other framework's, so it never takes a port the agent's own server wants.
 */
export const STATIC_PREVIEW_PORT = 4747;

/**
 * Where the server's source is written: `$HOME` (`SANDBOX_HOME` in the
 * runner's container spec), which is tmpfs, so it never shows in the Files
 * panel, a snapshot or a download, and is gone after an idle stop, when it
 * is written again.
 */
export const STATIC_PREVIEW_SCRIPT_PATH = "/home/sandbox/.static-preview.mjs";
const LOG_PATH = "/home/sandbox/.static-preview.log";

/** Providers whose sandboxes can serve a port and run `node`. */
const SERVES_PORTS: ReadonlySet<SandboxProvider> = new Set(["docker"]);

const HTML = /\.html?$/i;

/** Whether writing `path` should bring up the static preview. */
export const isStaticPage = (path: string): boolean => HTML.test(path);

export type StaticPreviewSandbox = Pick<
  Sandbox,
  "exec" | "exposePort" | "provider" | "writeFile"
>;

export interface StaticPreviewOptions {
  readonly signal?: AbortSignal;
  /** Waits between listener probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const describe = (error: SandboxError): string =>
  "message" in error ? `${error.type}: ${error.message}` : error.type;

const START_COMMAND = `nohup node ${STATIC_PREVIEW_SCRIPT_PATH} ${WORKDIR} ${STATIC_PREVIEW_PORT} > ${LOG_PATH} 2>&1 < /dev/null &`;

/** Writes the server into the sandbox and starts it in the background. */
const start = async (
  sandbox: StaticPreviewSandbox,
  signal: AbortSignal | undefined
): AsyncResult<void, string> => {
  // Written on every start: $HOME is emptied whenever the container stops.
  const written = await sandbox.writeFile(
    STATIC_PREVIEW_SCRIPT_PATH,
    STATIC_PREVIEW_SERVER
  );
  if (!written.ok) {
    return err(`couldn't write the server: ${describe(written.error)}`);
  }
  // Detached from the exec's streams, so the call returns while it runs.
  const started = await sandbox.exec(START_COMMAND, {
    signal,
    timeoutMs: 10_000,
  });
  if (!started.ok) {
    return err(`couldn't start the server: ${describe(started.error)}`);
  }
  return started.value.exitCode === 0
    ? ok(undefined)
    : err(`starting the server exited ${started.value.exitCode}`);
};

/**
 * Makes sure the sandbox serves `/work` on `STATIC_PREVIEW_PORT` and that
 * the port is exposed: starts the server unless one already listens, then
 * exposes the port (which the runner treats as idempotent). `null` when the
 * provider has no ports to serve from.
 */
export const ensureStaticPreview = async (
  sandbox: StaticPreviewSandbox,
  { signal, sleep }: StaticPreviewOptions = {}
): AsyncResult<{ port: number; url: string } | null, string> => {
  if (!SERVES_PORTS.has(sandbox.provider)) {
    return ok(null);
  }
  const probed = await waitForListener(sandbox, STATIC_PREVIEW_PORT, {
    attempts: 1,
    signal,
    sleep,
  });
  if (!probed.ok) {
    return err(`couldn't check the port: ${describe(probed.error)}`);
  }
  if (probed.value === "loopback") {
    return err(`port ${STATIC_PREVIEW_PORT} is taken by a localhost server`);
  }
  if (probed.value !== "reachable") {
    const started = await start(sandbox, signal);
    if (!started.ok) {
      return started;
    }
    // Without socket tables (`unknown`) there's nothing to wait on, so it
    // goes on to expose the port, as `preview` does.
    const up = await waitForListener(sandbox, STATIC_PREVIEW_PORT, {
      signal,
      sleep,
    });
    if (!up.ok) {
      return err(`couldn't check the port: ${describe(up.error)}`);
    }
    if (up.value === "none" || up.value === "loopback") {
      return err(`the server didn't come up; see ${LOG_PATH}`);
    }
  }
  const exposed = await sandbox.exposePort(STATIC_PREVIEW_PORT);
  return exposed.ok
    ? ok(exposed.value)
    : err(`couldn't expose the port: ${describe(exposed.error)}`);
};

export type PreviewLog = (message: string) => void;

export const consoleLog: PreviewLog = (message) => console.warn(message);

export interface StaticPageOptions extends StaticPreviewOptions {
  readonly log?: PreviewLog;
  /** Puts the preview on the sandbox's row (`recordPreview`), for the panel. */
  readonly record: (
    id: SandboxId,
    exposed: { readonly port: number; readonly url: string }
  ) => Promise<void>;
}

/**
 * The hook after a write lands: when `path` is a page, brings up the static
 * preview and records it. Never fails; what went wrong is logged.
 */
export const previewStaticPage = async (
  sandbox: StaticPreviewSandbox & Pick<Sandbox, "id">,
  path: string,
  { log = consoleLog, record, signal, sleep }: StaticPageOptions
): Promise<void> => {
  if (!isStaticPage(path)) {
    return;
  }
  // A throw here (the database, say) is still only the preview's failure,
  // and must not become the write's.
  try {
    const preview = await ensureStaticPreview(sandbox, { signal, sleep });
    if (!preview.ok) {
      log(`[sandbox] static preview for ${sandbox.id}: ${preview.error}`);
      return;
    }
    if (preview.value) {
      await record(sandbox.id, preview.value);
    }
  } catch (cause) {
    log(
      `[sandbox] static preview for ${sandbox.id} failed${cause instanceof Error ? `: ${cause.message}` : ""}`
    );
  }
};
