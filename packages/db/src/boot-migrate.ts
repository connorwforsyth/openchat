import { fromPromise } from "@workspace/shared/result";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Migrations at boot on Postgres (041), as the embedded PGlite already does:
// every replica that starts runs them, under a session-level advisory lock,
// so two boots at once apply each migration once. The first takes the lock
// and migrates; the others wait, then find nothing left to apply (drizzle
// skips what `__drizzle_migrations` records). Postgres releases the lock if
// the holder's connection dies, so a crashed boot never wedges the rest.
//
// No `import.meta.url` here: the Next.js server bundles this file, so the
// caller finds the migrations folder (`findMigrationsFolder`).

/**
 * The advisory lock's key: any fixed bigint works, as long as nothing else
 * in the database takes the same one.
 */
export const MIGRATION_LOCK_KEY = 4_283_104_719_224_657n;

/** How long a boot waits for another's migrations before giving up. */
const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** A lock held across processes. Postgres's is per connection (session). */
export interface MigrationLock {
  readonly acquire: () => Promise<void>;
  readonly release: () => Promise<void>;
}

/** Runs one SQL statement on one connection; the lock needs the same session throughout. */
export type SessionQuery = (sql: string) => Promise<unknown>;

/**
 * `pg_advisory_lock` on the given session. The wait is bounded by
 * `lock_timeout` (a boot that can't get the lock fails as a value rather
 * than hanging), then reset so the migrations themselves run without it.
 */
export const postgresAdvisoryLock = (
  query: SessionQuery,
  {
    key = MIGRATION_LOCK_KEY,
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  }: { readonly key?: bigint; readonly timeoutMs?: number } = {}
): MigrationLock => ({
  acquire: async () => {
    await query(`set lock_timeout = ${Math.max(0, Math.floor(timeoutMs))}`);
    try {
      await query(`select pg_advisory_lock(${key})`);
    } finally {
      await query("reset lock_timeout");
    }
  },
  release: async () => {
    await query(`select pg_advisory_unlock(${key})`);
  },
});

/** Runs `work` holding `lock`; the lock is released however `work` ends. */
export const withMigrationLock = async <T>(
  lock: MigrationLock,
  work: () => Promise<T>
): Promise<T> => {
  await lock.acquire();
  try {
    return await work();
  } finally {
    await lock.release();
  }
};

export interface BootMigrationError {
  /** Postgres's message; it never carries the connection string. */
  readonly message: string;
  readonly type: "migration_failed";
}

/**
 * Applies pending migrations from `migrationsFolder` to `url` under the
 * advisory lock, on one short-lived connection (so the lock, the migrations
 * and the unlock share a session). Fails as a value.
 */
export const migratePostgresOnBoot = (
  url: string,
  {
    lockTimeoutMs,
    migrationsFolder,
  }: { readonly lockTimeoutMs?: number; readonly migrationsFolder: string }
) =>
  fromPromise<void, BootMigrationError>(
    async () => {
      const client = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const lock = postgresAdvisoryLock((sql) => client.unsafe(sql), {
          timeoutMs: lockTimeoutMs,
        });
        await withMigrationLock(lock, () =>
          migrate(drizzle({ client }), { migrationsFolder })
        );
      } finally {
        await client.end();
      }
    },
    (cause) => ({
      message: cause instanceof Error ? cause.message : String(cause),
      type: "migration_failed",
    })
  );
