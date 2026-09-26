import type postgres from "postgres";

// LISTEN, which query builders don't model: every driver has its own call.
// The stream channel only needs "tell me when this channel is notified";
// NOTIFY itself is plain SQL (`pg_notify`) and goes through drizzle.

/** Calls `onPayload` for each NOTIFY on `channel`; resolves to an unsubscribe. */
export type Listen = (
  channel: string,
  onPayload: (payload: string) => void
) => Promise<() => Promise<void>>;

/**
 * postgres.js keeps one dedicated connection for every `listen` on a client
 * and re-subscribes after a reconnect.
 */
export const postgresListen =
  (sql: postgres.Sql): Listen =>
  async (channel, onPayload) => {
    const request = await sql.listen(channel, onPayload);
    return () => request.unlisten();
  };

/** The part of PGlite (tests, single-process dev) that LISTEN needs. */
export interface PgliteListener {
  listen: (
    channel: string,
    callback: (payload: string) => void
  ) => Promise<() => Promise<void>>;
}

export const pgliteListen =
  (client: PgliteListener): Listen =>
  (channel, onPayload) =>
    client.listen(channel, onPayload);
