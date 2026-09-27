import { join } from "node:path";

import {
  type BootMigrationError,
  migratePostgresOnBoot,
} from "@workspace/db/boot-migrate";
import { connectFromEnv, type Db } from "@workspace/db/client";
import { findMigrationsFolder, openEmbeddedDb } from "@workspace/db/embedded";
import type { AsyncResult } from "@workspace/shared/result";
import { type ConstructorOptions, fromPglite } from "pg-boss";
import postgres from "postgres";

import { type Listen, pgliteListen, postgresListen } from "../stream/listen";

// Which database the server runs on (Q15): Postgres from DATABASE_URL, or,
// with none set, the embedded PGlite in `<dataDir>/pglite`. Both are
// migrated at boot; on Postgres under an advisory lock (041), so replicas
// starting together apply each migration once. Each comes with the two
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

/** Applies pending migrations to a Postgres URL (the advisory-locked one by default). */
export type MigratePostgres = (
  url: string,
  options: { readonly migrationsFolder: string }
) => AsyncResult<void, BootMigrationError>;

export interface OpenDatabaseOptions {
  /** Where the embedded database lives (`<dataDir>/pglite`). */
  readonly dataDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Boot notices meant for whoever runs the server. */
  readonly log: (message: string) => void;
  /** Postgres migrations at boot; `false` leaves them to `bun turbo db:migrate`. */
  readonly migrate?: MigratePostgres | false;
  /** Where the migrations are; found from the working directory by default. */
  readonly migrationsFolder?: string | null;
}

/**
 * Migrates Postgres before anything queries it. A failure doesn't stop the
 * boot (AGENTS.md: degrade, don't crash): the server says why and runs on
 * whatever schema is there, and `bun turbo db:migrate` can finish the job.
 */
const migrateAtBoot = async (
  url: string,
  {
    log,
    migrate = migratePostgresOnBoot,
    migrationsFolder = findMigrationsFolder(),
  }: Pick<OpenDatabaseOptions, "log" | "migrate" | "migrationsFolder">
): Promise<void> => {
  if (migrate === false) {
    return;
  }
  if (!migrationsFolder) {
    log(
      "[db] the migrations weren't found (looked under node_modules/@workspace/db/drizzle); run `bun turbo db:migrate`"
    );
    return;
  }
  const migrated = await migrate(url, { migrationsFolder });
  if (!migrated.ok) {
    log(
      `[db] migrations didn't apply (${migrated.error.message}); run \`bun turbo db:migrate\``
    );
  }
};

export const openDatabase = async ({
  dataDir,
  env,
  log,
  migrate,
  migrationsFolder,
}: OpenDatabaseOptions): Promise<DatabaseChoice> => {
  const connection = connectFromEnv(env);
  if (connection.ok) {
    const url = env.DATABASE_URL?.trim() ?? "";
    await migrateAtBoot(url, { log, migrate, migrationsFolder });
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
