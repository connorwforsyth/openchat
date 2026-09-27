import { join } from "node:path";

import { connectFromEnv, type Db } from "@workspace/db/client";
import { openEmbeddedDb } from "@workspace/db/embedded";
import { type ConstructorOptions, fromPglite } from "pg-boss";
import postgres from "postgres";

import { type Listen, pgliteListen, postgresListen } from "../stream/listen";

// Which database the server runs on (Q15): Postgres from DATABASE_URL, or,
// with none set, the embedded PGlite in `<dataDir>/pglite`, migrated at
// boot, so `bun dev` works with nothing configured. Each comes with the two
// things that talk to the database outside drizzle: LISTEN for stream
// fan-out, and pg-boss's connection.

export interface Database {
  readonly close: () => Promise<void>;
  readonly db: Db;
  readonly engine: "pglite" | "postgres";
  /** How pg-boss connects (it brings its own pool on Postgres). */
  readonly jobs: ConstructorOptions;
  readonly listen: Listen;
}

export type DatabaseProblem =
  | { readonly type: "invalid_url" }
  | { readonly message: string; readonly type: "embedded_failed" };

export type DatabaseChoice =
  | { readonly database: Database; readonly ok: true }
  | { readonly ok: false; readonly problem: DatabaseProblem };

export interface OpenDatabaseOptions {
  /** Where the embedded database lives (`<dataDir>/pglite`). */
  readonly dataDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Boot notices meant for whoever runs the server. */
  readonly log: (message: string) => void;
}

export const openDatabase = async ({
  dataDir,
  env,
  log,
}: OpenDatabaseOptions): Promise<DatabaseChoice> => {
  const connection = connectFromEnv(env);
  if (connection.ok) {
    const url = env.DATABASE_URL?.trim() ?? "";
    // LISTEN holds a connection of its own; one is plenty for every stream.
    const listener = postgres(url, { max: 1, onnotice: () => undefined });
    return {
      database: {
        close: async () => {
          await listener.end();
          await connection.value.close();
        },
        db: connection.value.db,
        engine: "postgres",
        jobs: { connectionString: url },
        listen: postgresListen(listener),
      },
      ok: true,
    };
  }
  if (connection.error.type === "invalid_url") {
    return { ok: false, problem: { type: "invalid_url" } };
  }
  const embedded = await openEmbeddedDb(join(dataDir, "pglite"));
  if (!embedded.ok) {
    return { ok: false, problem: embedded.error };
  }
  const { client } = embedded.value;
  log(
    `[db] DATABASE_URL is not set: using the embedded database in ${embedded.value.dataDir} (migrated; one process only). Set DATABASE_URL to use Postgres.`
  );
  return {
    database: {
      close: embedded.value.close,
      db: embedded.value.db,
      engine: "pglite",
      // pg-boss 12 runs on PGlite through the same single connection.
      jobs: { backend: "pglite", db: fromPglite(client) },
      listen: pgliteListen(client),
    },
    ok: true,
  };
};
