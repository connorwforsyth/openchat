import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { migratePostgres } from "./migrator";

// `bun run db:migrate` (or `bun turbo db:migrate` from the root): applies
// pending migrations to DATABASE_URL, e.g. the compose Postgres. Turbo runs
// this from packages/db, so the repo root's .env is loaded when the variable
// isn't already set.

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const url = process.env.DATABASE_URL?.trim();
if (url) {
  try {
    await migratePostgres(url);
    console.log("Migrations applied.");
  } catch (cause) {
    // Postgres errors don't carry the connection string, so the message is safe to print.
    console.error(
      "Migration failed:",
      cause instanceof Error ? cause.message : cause
    );
    process.exitCode = 1;
  }
} else {
  console.error(
    "DATABASE_URL is not set. Start the compose Postgres (`docker compose up -d`) and set DATABASE_URL (see .env.example)."
  );
  process.exitCode = 1;
}
