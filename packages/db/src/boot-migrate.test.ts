import { readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { newId } from "@workspace/shared/ids";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";

import {
  MIGRATION_LOCK_KEY,
  migratePostgresOnBoot,
  postgresAdvisoryLock,
  type SessionQuery,
  withMigrationLock,
} from "./boot-migrate";
import { MIGRATIONS_FOLDER } from "./migrator";

// Migrations at boot (041): concurrent boots apply each migration once.
//
// PGlite is one connection, one session: every "boot" on it is the same
// session, and Postgres advisory locks are re-entrant within a session, so
// PGlite can't show two sessions contending. The contention is therefore
// played by a stand-in for the server's lock table (`advisoryServer`), one
// session per boot, speaking the same SQL `postgresAdvisoryLock` sends; the
// migrations themselves are the real ones on a real (PGlite) database. The
// SQL is also run on PGlite itself, and on a real Postgres when
// TEST_DATABASE_URL is set (CI's `db` job), where two real boots race.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const migrationCount = async () =>
  (await readdir(MIGRATIONS_FOLDER, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory()
  ).length;

const LOCK = /^select pg_advisory_lock\((\d+)\)$/;
const UNLOCK = /^select pg_advisory_unlock\((\d+)\)$/;

/**
 * Postgres's advisory lock table, as far as the lock uses it: a session
 * blocks on a key another session holds and wakes when it's released.
 */
const advisoryServer = () => {
  const held = new Map<string, symbol>();
  const waiting: (() => void)[] = [];
  const statements: string[] = [];
  const session = (): SessionQuery => {
    const me = Symbol("session");
    return async (sql) => {
      statements.push(sql);
      const [, key] = LOCK.exec(sql) ?? [];
      const [, unlocked] = UNLOCK.exec(sql) ?? [];
      if (key) {
        while (held.has(key) && held.get(key) !== me) {
          // biome-ignore lint/performance/noAwaitInLoops: a blocked session waits for each release in turn.
          await new Promise<void>((wake) => waiting.push(wake));
        }
        held.set(key, me);
      } else if (unlocked && held.get(unlocked) === me) {
        held.delete(unlocked);
        for (const wake of waiting.splice(0)) {
          wake();
        }
      }
      return [];
    };
  };
  return { session, statements };
};

const freshPglite = async () => {
  const client = await PGlite.create({ extensions: { vector } });
  closers.push(() => client.close());
  return client;
};

describe("migrations at boot", () => {
  it("applies each migration once across two concurrent boots", async () => {
    const client = await freshPglite();
    const server = advisoryServer();
    let running = 0;
    let overlapped = false;
    const boot = () =>
      withMigrationLock(postgresAdvisoryLock(server.session()), async () => {
        running += 1;
        overlapped ||= running > 1;
        try {
          await migrate(drizzle({ client }), {
            migrationsFolder: MIGRATIONS_FOLDER,
          });
        } finally {
          running -= 1;
        }
      });

    await Promise.all([boot(), boot()]);

    expect(overlapped).toBe(false);
    const applied = await client.query<{ hash: string }>(
      "select hash from drizzle.__drizzle_migrations"
    );
    expect(applied.rows).toHaveLength(await migrationCount());
    expect(new Set(applied.rows.map((row) => row.hash)).size).toBe(
      applied.rows.length
    );
    // Each boot took and released the lock, waiting bounded by lock_timeout.
    expect(
      server.statements.filter((sql) => sql.startsWith("select pg_advisory"))
    ).toEqual([
      `select pg_advisory_lock(${MIGRATION_LOCK_KEY})`,
      `select pg_advisory_lock(${MIGRATION_LOCK_KEY})`,
      `select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`,
      `select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`,
    ]);
    expect(server.statements).toContain("reset lock_timeout");
  });

  it("releases the lock when a migration fails", async () => {
    const server = advisoryServer();
    const failing = withMigrationLock(
      postgresAdvisoryLock(server.session()),
      () => Promise.reject(new Error("syntax error"))
    );
    await expect(failing).rejects.toThrow("syntax error");
    // A second boot gets the lock at once instead of waiting forever.
    await withMigrationLock(postgresAdvisoryLock(server.session()), () =>
      Promise.resolve()
    );
    expect(server.statements.at(-1)).toBe(
      `select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    );
  });

  it("speaks SQL Postgres runs: the lock shows in pg_locks while held", async () => {
    const client = await freshPglite();
    const lock = postgresAdvisoryLock((sql) => client.query(sql));
    const advisory = async () =>
      (
        await client.query<{ n: number }>(
          "select count(*)::int as n from pg_locks where locktype = 'advisory'"
        )
      ).rows[0]?.n;
    await lock.acquire();
    expect(await advisory()).toBe(1);
    await lock.release();
    expect(await advisory()).toBe(0);
  });
});

const serverUrl = process.env.TEST_DATABASE_URL?.trim();

describe.runIf(serverUrl)("migrations at boot on Postgres", () => {
  it("two boots racing on one database both succeed and apply each migration once", async () => {
    const admin = postgres(serverUrl ?? "", {
      max: 1,
      onnotice: () => undefined,
    });
    const name = `boot_${newId("testDb").replaceAll("-", "")}`;
    await admin.unsafe(`create database "${name}"`);
    closers.push(async () => {
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end();
    });
    const url = new URL(serverUrl ?? "");
    url.pathname = `/${name}`;
    const boot = () =>
      migratePostgresOnBoot(url.toString(), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

    const [first, second] = await Promise.all([boot(), boot()]);
    expect(first.ok && second.ok).toBe(true);

    const check = postgres(url.toString(), { max: 1 });
    const rows = await check.unsafe(
      "select hash from drizzle.__drizzle_migrations"
    );
    await check.end();
    expect(rows).toHaveLength(await migrationCount());
  });
});
