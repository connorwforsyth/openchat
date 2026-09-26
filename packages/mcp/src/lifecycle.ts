import { UnauthorizedError } from "@ai-sdk/mcp";

import { type McpError, unavailable } from "./errors";

// Connection lifecycle policy, ported from LibreChat's MCPConnection
// (reconnect backoff with jitter, the per-connection circuit breaker, the
// 429 stop) as pure functions over plain state. The manager owns the state
// and the clock; these only decide.

export interface Timeouts {
  /** Connect and `initialize`. LibreChat: 30s. */
  readonly initMs: number;
  /** `tools/list`, all pages. LibreChat: 30s. */
  readonly listToolsMs: number;
  /** One `tools/call`. LibreChat: 60s. */
  readonly requestMs: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  initMs: 30_000,
  listToolsMs: 30_000,
  requestMs: 60_000,
};

export interface ReconnectPolicy {
  /** Tries per round when a connection that worked has dropped. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly jitterMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RECONNECT: ReconnectPolicy = {
  attempts: 3,
  baseDelayMs: 1000,
  jitterMs: 1000,
  maxDelayMs: 30_000,
};

/** Exponential with jitter, so a restarted server isn't hit by every client at once. */
export const backoffDelay = (
  policy: ReconnectPolicy,
  attempt: number,
  random: () => number
): number =>
  Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs) +
  Math.floor(random() * policy.jitterMs);

export interface CircuitPolicy {
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  /** Failed rounds inside the window before the breaker opens. */
  readonly maxFailedRounds: number;
  readonly windowMs: number;
}

export const DEFAULT_CIRCUIT: CircuitPolicy = {
  baseBackoffMs: 30_000,
  maxBackoffMs: 300_000,
  maxFailedRounds: 3,
  windowMs: 120_000,
};

export interface CircuitState {
  readonly failedRounds: number;
  /** Until when new attempts fail fast. */
  readonly openUntil: number;
  readonly windowStart: number;
}

export const closedCircuit = (now: number): CircuitState => ({
  failedRounds: 0,
  openUntil: 0,
  windowStart: now,
});

export const isCircuitOpen = (state: CircuitState, now: number): boolean =>
  now < state.openUntil;

/** One more failed round; past the threshold, back off exponentially (capped). */
export const recordFailedRound = (
  state: CircuitState,
  policy: CircuitPolicy,
  now: number
): CircuitState => {
  const fresh = now - state.windowStart > policy.windowMs;
  const failedRounds = (fresh ? 0 : state.failedRounds) + 1;
  const windowStart = fresh ? now : state.windowStart;
  if (failedRounds < policy.maxFailedRounds) {
    return { failedRounds, openUntil: state.openUntil, windowStart };
  }
  const backoff = Math.min(
    policy.baseBackoffMs * 2 ** (failedRounds - policy.maxFailedRounds),
    policy.maxBackoffMs
  );
  return { failedRounds, openUntil: now + backoff, windowStart };
};

const causes = function* (error: unknown): Generator<unknown> {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    yield current;
    current =
      current !== null && typeof current === "object" && "cause" in current
        ? current.cause
        : undefined;
  }
};

// `MCPClientError` isn't exported, so read its HTTP status by shape.
const statusOf = (error: unknown): number | undefined => {
  for (const cause of causes(error)) {
    if (
      cause !== null &&
      typeof cause === "object" &&
      "statusCode" in cause &&
      typeof cause.statusCode === "number"
    ) {
      return cause.statusCode;
    }
  }
};

const codeOf = (error: unknown): string | undefined => {
  for (const cause of causes(error)) {
    if (
      cause !== null &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string"
    ) {
      return cause.code;
    }
  }
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message.toLowerCase() : "";

export const isUnauthorized = (error: unknown): boolean =>
  [...causes(error)].some((cause) => cause instanceof UnauthorizedError) ||
  statusOf(error) === 401;

/** A server that says slow down: stop reconnecting until someone asks again. */
export const isRateLimited = (error: unknown): boolean => {
  const message = messageOf(error);
  return (
    statusOf(error) === 429 ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  );
};

/**
 * The request never reached a live session, so sending it again can't run a
 * tool twice: the server forgot our session (404, it restarted) or nothing
 * was listening (connection refused).
 */
export const wasNotDelivered = (error: unknown): boolean =>
  statusOf(error) === 404 || codeOf(error) === "ECONNREFUSED";

// The socket died under a request: it may or may not have been processed,
// so reconnect, but don't resend.
const LOST_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

/** Transport-level failure (vs a JSON-RPC error from a healthy server). */
export const isConnectionLost = (error: unknown): boolean => {
  if (wasNotDelivered(error) || LOST_CODES.has(codeOf(error) ?? "")) {
    return true;
  }
  const message = messageOf(error);
  return (
    message.includes("connection closed") ||
    message.includes("fetch failed") ||
    message.includes("not connected") ||
    message.includes("terminated")
  );
};

/** A failure as an error value; never includes response bodies or headers. */
export const classifyError = (error: unknown): McpError => {
  if (isUnauthorized(error)) {
    return { type: "needs_auth" };
  }
  if (isRateLimited(error)) {
    return unavailable("The MCP server is rate limiting requests.");
  }
  const message = messageOf(error);
  if (message.includes("timed out") || message.includes("timeout")) {
    return unavailable("The MCP server didn't respond in time.");
  }
  const status = statusOf(error);
  if (status === 403) {
    return unavailable("The MCP server refused access.");
  }
  return unavailable(
    status === undefined
      ? "Couldn't connect to the MCP server."
      : `The MCP server answered HTTP ${status}.`
  );
};
