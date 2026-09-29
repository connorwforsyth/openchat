import { type AsyncResult, ok } from "@workspace/shared/result";

import type { Sandbox, SandboxError } from "../ports/sandbox";

// Whether something in the sandbox listens on a port (063). The `preview`
// tool checks before exposing a port, and the static preview (067) checks
// before starting its server. The check reads the kernel's socket tables,
// which every Linux image has, rather than relying on `ss` or `netstat`.
// The preview proxy dials the container's own address, so a server bound
// only to loopback is as unreachable as none.

/** Probes before giving up, `PROBE_INTERVAL_MS` apart: about 5 s for a server to come up. */
export const PROBE_ATTEMPTS = 10;
export const PROBE_INTERVAL_MS = 500;
const PROBE_COMMAND = "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null";
/** The `st` column's value for a listening socket. */
const TCP_LISTEN = "0A";
/** A row of `/proc/net/tcp{,6}`: `sl local_address rem_address st ...`. */
const SOCKET_ROW =
  /^\s*\d+:\s+([0-9A-Fa-f]+):([0-9A-Fa-f]{4})\s+\S+\s+([0-9A-Fa-f]{2})\s/;
const TABLE_HEADER = /^\s*sl\s+local_address/m;
/** ::1, and 127.0.0.0/8 plain or IPv4-mapped; addresses are little-endian words. */
const LOOPBACK = /^(?:[0-9A-F]{6}7F|0{16}FFFF0{4}[0-9A-F]{6}7F|0{24}01000000)$/;

/** `unknown`: no socket tables to read (just-bash has no /proc). */
export type Listening = "loopback" | "none" | "reachable" | "unknown";

/** Whether `port` is listening in the socket tables `output` holds. */
export const listeningOn = (output: string, port: number): Listening => {
  if (!TABLE_HEADER.test(output)) {
    return "unknown";
  }
  let loopback = false;
  for (const line of output.split("\n")) {
    const row = SOCKET_ROW.exec(line);
    if (
      !row ||
      row[3]?.toUpperCase() !== TCP_LISTEN ||
      Number.parseInt(row[2] ?? "", 16) !== port
    ) {
      continue;
    }
    if (!LOOPBACK.test(row[1]?.toUpperCase() ?? "")) {
      return "reachable";
    }
    loopback = true;
  }
  return loopback ? "loopback" : "none";
};

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface WaitForListenerOptions {
  /** Probes before settling for `none`; 1 checks once without waiting. */
  readonly attempts?: number;
  readonly signal?: AbortSignal;
  /** Waits between probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Probes `port` until something listens on it, it turns out to be bound
 * only to loopback, the tables can't be read, or `attempts` run out
 * (`none`).
 */
export const waitForListener = async (
  sandbox: Pick<Sandbox, "exec">,
  port: number,
  {
    attempts = PROBE_ATTEMPTS,
    signal,
    sleep = wait,
  }: WaitForListenerOptions = {},
  attempt = 1
): AsyncResult<Listening, SandboxError> => {
  const probed = await sandbox.exec(PROBE_COMMAND, {
    signal,
    timeoutMs: 5000,
  });
  if (!probed.ok) {
    return probed;
  }
  const state = listeningOn(probed.value.stdout, port);
  if (state !== "none" || attempt >= attempts || signal?.aborted) {
    return ok(state);
  }
  await sleep(PROBE_INTERVAL_MS);
  return waitForListener(
    sandbox,
    port,
    { attempts, signal, sleep },
    attempt + 1
  );
};
