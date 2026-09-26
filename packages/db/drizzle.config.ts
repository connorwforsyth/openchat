import { defineConfig } from "drizzle-kit";

// `db:generate` diffs the schema against the last snapshot in `drizzle/` and
// writes a new migration; it never connects to a database. Migrations are
// applied by `db:migrate` (src/migrate.ts) and by `createTestDb`.
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema/*.ts",
});
