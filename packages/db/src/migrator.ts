import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * The generated SQL migrations (`bun run db:generate`). Resolved from this
 * file so it works from any working directory.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../drizzle", import.meta.url)
);

/**
 * Applies pending migrations to a Postgres server on its own short-lived
 * connection. Rejects if a migration fails; drizzle runs each in a
 * transaction, so a failure leaves the database at the previous one.
 */
export const migratePostgres = async (url: string): Promise<void> => {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
};
