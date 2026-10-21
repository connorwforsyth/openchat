import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MIGRATIONS_FOLDER } from "./migrator";

// Lanes that each generate a migration from the same parent snapshot leave a
// fork in the history once merged, and `drizzle-kit generate` then refuses to
// run. Migrations apply in folder order, so each snapshot's parent must be
// the one before it.

const Snapshot = z.object({ id: z.string(), prevIds: z.array(z.string()) });
const ORIGIN = "00000000-0000-0000-0000-000000000000";

const snapshots = async () => {
  const folders = (await readdir(MIGRATIONS_FOLDER, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    folders.map(async (folder) => ({
      folder,
      ...Snapshot.parse(
        JSON.parse(
          await readFile(
            join(MIGRATIONS_FOLDER, folder, "snapshot.json"),
            "utf8"
          )
        )
      ),
    }))
  );
};

describe("migration history", () => {
  it("is one chain in folder order", async () => {
    const history = await snapshots();
    const parents = history.map(({ folder, prevIds }) => ({ folder, prevIds }));
    const expected = history.map(({ folder }, index) => ({
      folder,
      prevIds: [index === 0 ? ORIGIN : history[index - 1]?.id],
    }));
    expect(parents).toEqual(expected);
  });
});
