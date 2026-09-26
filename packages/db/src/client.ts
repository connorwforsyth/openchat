import { err, ok, type Result } from "@workspace/shared/result";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DbConfigError } from "./errors";
import { type Relations, relations } from "./schema/relations";

// The database handle every query module takes as its first argument (ports
// are function arguments, D8). Production connects with postgres.js; tests
// pass a PGlite handle from `@workspace/db/testing`. A transaction handle is
// a `Db` too, so query functions compose inside `db.transaction`.

export type Db = PgAsyncDatabase<PgQueryResultHKT, Relations>;

export interface DbConnection {
  /** Closes the pool; waits for running queries to finish. */
  readonly close: () => Promise<void>;
  readonly db: Db;
}

export interface ConnectOptions {
  /** Pool size; postgres.js opens connections lazily, up to this many. */
  readonly max?: number;
}

const POSTGRES_URL = /^postgres(?:ql)?:\/\//;

/**
 * Connects to `url`. Nothing is sent until the first query, so this never
 * fails on an unreachable server; a bad URL is the only error.
 */
export const connect = (
  url: string,
  { max = 10 }: ConnectOptions = {}
): Result<DbConnection, DbConfigError> => {
  if (!POSTGRES_URL.test(url)) {
    // Never echo the URL: it usually carries a password.
    return err({
      message: "DATABASE_URL must start with postgres:// or postgresql://",
      type: "invalid_url",
    });
  }
  const client = postgres(url, {
    max,
    // Postgres NOTICEs (IF NOT EXISTS skips during migrations) aren't news.
    onnotice: () => undefined,
  });
  const db = drizzle({ client, relations });
  return ok({ close: () => client.end(), db });
};

/**
 * Connects from `DATABASE_URL`. An empty environment is `not_configured`, so
 * the app can boot without a database and say so instead of crashing.
 */
export const connectFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  options?: ConnectOptions
): Result<DbConnection, DbConfigError> => {
  const url = env.DATABASE_URL?.trim();
  return url ? connect(url, options) : err({ type: "not_configured" });
};
