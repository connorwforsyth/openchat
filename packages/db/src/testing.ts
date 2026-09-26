import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import type { Result } from "@workspace/shared/result";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";

import { connect, type Db } from "./client";
import { MIGRATIONS_FOLDER, migratePostgres } from "./migrator";
import { member, organization, user } from "./schema/auth";
import { relations } from "./schema/relations";
import { team } from "./schema/tenancy";

// A migrated, empty database for tests, for this package and any other that
// touches the database (`import { createTestDb } from "@workspace/db/testing"`).
//
// By default it's PGlite (in-process Postgres with pgvector, D9): no Docker,
// no network. PGlite is Postgres 18 while production runs 17, so CI's `db`
// job sets TEST_DATABASE_URL to a Postgres 17 server and the same tests run
// there, each `createTestDb` in a fresh database of its own.

export interface TestDb {
  /** Frees the database (and drops it, on a server). Call in `afterAll`. */
  readonly close: () => Promise<void>;
  readonly db: Db;
  /** Which engine the tests ran on, for the rare test that must know. */
  readonly engine: "pglite" | "postgres";
}

/** Where `globalSetup` leaves the migrated template for the test workers. */
export const TEMPLATE_ENV = "DB_TEST_TEMPLATE";

/** A freshly migrated PGlite, dumped: the template every test database clones. */
export const buildTemplate = async (): Promise<Blob> => {
  const client = await PGlite.create({ extensions: { vector } });
  await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  const dump = await client.dumpDataDir("none");
  await client.close();
  return dump;
};

// Migrating takes about a second of WASM work. `globalSetup`
// (`@workspace/db/testing-setup`) does it once per run and every worker
// clones the dump; without it, each worker migrates once and clones that.
let template: Promise<Blob> | undefined;

const migratedTemplate = (): Promise<Blob> => {
  template ??= (async () => {
    const path = process.env[TEMPLATE_ENV];
    return path ? new Blob([await readFile(path)]) : buildTemplate();
  })();
  return template;
};

const createPgliteDb = async (): Promise<TestDb> => {
  const client = await PGlite.create({
    extensions: { vector },
    loadDataDir: await migratedTemplate(),
  });
  return {
    close: () => client.close(),
    db: drizzle({ client, relations }),
    engine: "pglite",
  };
};

const createPostgresDb = async (serverUrl: string): Promise<TestDb> => {
  const name = `test_${newId("testDb").replaceAll("-", "")}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database "${name}"`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  await migratePostgres(url.toString());
  const connection = connect(url.toString(), { max: 4 });
  if (!connection.ok) {
    await admin.end();
    throw new Error("TEST_DATABASE_URL is not a postgres:// URL");
  }
  return {
    close: async () => {
      await connection.value.close();
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end();
    },
    db: connection.value.db,
    engine: "postgres",
  };
};

/** A fresh, migrated database: PGlite, or a new database on TEST_DATABASE_URL. */
export const createTestDb = (): Promise<TestDb> => {
  const serverUrl = process.env.TEST_DATABASE_URL?.trim();
  return serverUrl ? createPostgresDb(serverUrl) : createPgliteDb();
};

// --- Seed helpers: the rows most tests need before the one they're about ---

let seq = 0;
const nextSeq = () => {
  seq += 1;
  return seq;
};

/** A user with a unique email. */
export const seedUser = async (
  db: Db,
  values: Partial<typeof user.$inferInsert> = {}
): Promise<typeof user.$inferSelect> => {
  const n = nextSeq();
  const [row] = await db
    .insert(user)
    .values({
      email: `user${n}-${newId("x")}@example.test`,
      name: `User ${n}`,
      ...values,
    })
    .returning();
  if (!row) {
    throw new Error("seedUser: no row");
  }
  return row;
};

/** An org with `ownerId` as its owner member; `isPersonal` for a personal space. */
export const seedOrg = async (
  db: Db,
  ownerId: UserId,
  values: Partial<typeof organization.$inferInsert> = {}
): Promise<typeof organization.$inferSelect> => {
  const n = nextSeq();
  const [row] = await db
    .insert(organization)
    .values({
      name: `Org ${n}`,
      slug: `org-${n}-${newId("x").slice(-12)}`,
      ...values,
    })
    .returning();
  if (!row) {
    throw new Error("seedOrg: no row");
  }
  await db
    .insert(member)
    .values({ organizationId: row.id, role: "owner", userId: ownerId });
  return row;
};

/** A team in `orgId`, under `parentId` if given. */
export const seedTeam = async (
  db: Db,
  orgId: OrgId,
  parentId: TeamId | null = null,
  name = `Team ${nextSeq()}`
): Promise<typeof team.$inferSelect> => {
  const [row] = await db
    .insert(team)
    .values({ name, orgId, parentId })
    .returning();
  if (!row) {
    throw new Error("seedTeam: no row");
  }
  return row;
};

/** The value of an `ok` result; fails the test with the error otherwise. */
export const expectOk = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
};
