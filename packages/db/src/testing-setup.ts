import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTemplate, TEMPLATE_ENV } from "./testing";

// Vitest `globalSetup` for any package whose tests use `createTestDb`:
// migrates one PGlite before the workers start and hands them the dump, so
// no worker spends its hook timeout migrating. Skipped when the tests run
// against a server (TEST_DATABASE_URL), which migrates per database.

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL?.trim()) {
    return async () => undefined;
  }
  const dir = await mkdtemp(join(tmpdir(), "db-template-"));
  const path = join(dir, "template.tar");
  await writeFile(
    path,
    Buffer.from(await (await buildTemplate()).arrayBuffer())
  );
  process.env[TEMPLATE_ENV] = path;
  return () => rm(dir, { force: true, recursive: true });
}
