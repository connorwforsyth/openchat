import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { fromPromise } from "@workspace/shared/result";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Db } from "./client";
import { relations } from "./schema/relations";

// The zero-setup database (PLAN.md Q15): with no DATABASE_URL the server runs
// on PGlite, Postgres compiled to WASM, persisted to a directory, with every
// migration applied at boot. It is one connection in one process, so it
// suits `bun dev` and single-user trials, not a deployment; set
// DATABASE_URL for anything shared.

export interface EmbeddedDb {
  /** The PGlite client, for adapters that speak to it directly (pg-boss, LISTEN). */
  readonly client: PGlite;
  readonly close: () => Promise<void>;
  /** Absolute path of the data directory. */
  readonly dataDir: string;
  readonly db: Db;
}

export interface EmbeddedDbError {
  readonly message: string;
  readonly type: "embedded_failed";
}

/**
 * Where the SQL migrations are, found from the working directory. Not from
 * `import.meta.url` as `migrator.ts` does: inside a bundle (the Next.js
 * server) this file no longer sits next to them, and bundlers try to turn
 * `new URL("../drizzle", import.meta.url)` into an asset, which a directory
 * can't be. Every app that boots a server depends on this package, so it's
 * linked under `node_modules`; the repo layout covers scripts run from the root.
 */
export const findMigrationsFolder = (
  cwd: string = process.cwd()
): string | null =>
  [
    join(cwd, "node_modules", "@workspace", "db", "drizzle"),
    join(cwd, "packages", "db", "drizzle"),
  ].find((folder) => existsSync(folder)) ?? null;

/**
 * Opens (creating if needed) the PGlite database in `dataDir` and migrates
 * it. Fails as a value: another process holding the directory, or a data
 * directory from an incompatible PGlite, shouldn't crash boot.
 */
export const openEmbeddedDb = (
  dataDir: string,
  migrationsFolder: string | null = findMigrationsFolder()
) =>
  fromPromise<EmbeddedDb, EmbeddedDbError>(
    async () => {
      if (!migrationsFolder) {
        throw new Error(
          "the database migrations weren't found (looked under node_modules/@workspace/db/drizzle)"
        );
      }
      const path = resolve(dataDir);
      await mkdir(path, { recursive: true });
      const client = await PGlite.create({
        dataDir: path,
        extensions: { vector },
      });
      try {
        await migrate(drizzle({ client }), {
          migrationsFolder,
        });
      } catch (cause) {
        await client.close();
        throw cause;
      }
      return {
        client,
        close: () => client.close(),
        dataDir: path,
        db: drizzle({ client, relations }),
      };
    },
    (cause) => ({
      // PGlite can reject with a plain object (a WASM abort, say).
      message:
        cause instanceof Error
          ? cause.message
          : JSON.stringify(cause) ?? String(cause),
      type: "embedded_failed",
    })
  );
