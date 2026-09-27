import { ok } from "@workspace/shared/result";
import { describe, expect, it, vi } from "vitest";

import { type MigratePostgres, openDatabase } from "./database";

// Postgres is migrated at boot (041). The locked migration itself is tested
// in `@workspace/db` (boot-migrate); here, that boot runs it once, before
// the database is handed out, and carries on when it fails. Nothing here
// connects: postgres.js opens connections lazily.

const env = { DATABASE_URL: "postgres://app@127.0.0.1:1/app" };

describe("openDatabase on Postgres", () => {
  it("migrates before handing the database out", async () => {
    const migrate = vi.fn<MigratePostgres>(() =>
      Promise.resolve(ok(undefined))
    );
    const opened = await openDatabase({
      dataDir: "unused",
      env,
      log: () => undefined,
      migrate,
      migrationsFolder: "/migrations",
    });
    expect(opened.ok && opened.database.engine).toBe("postgres");
    expect(migrate).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledWith(env.DATABASE_URL, {
      migrationsFolder: "/migrations",
    });
    if (opened.ok) {
      await opened.database.close();
    }
  });

  it("says why when the migrations fail, and still boots", async () => {
    const logged: string[] = [];
    const opened = await openDatabase({
      dataDir: "unused",
      env,
      log: (message) => logged.push(message),
      migrate: () =>
        Promise.resolve({
          error: {
            message: "connect ECONNREFUSED",
            type: "migration_failed" as const,
          },
          ok: false as const,
        }),
      migrationsFolder: "/migrations",
    });
    expect(opened.ok).toBe(true);
    expect(logged.join("\n")).toContain("migrations didn't apply");
    if (opened.ok) {
      await opened.database.close();
    }
  });

  it("leaves them alone when told to, or when there are none to find", async () => {
    const migrate = vi.fn<MigratePostgres>(() =>
      Promise.resolve(ok(undefined))
    );
    const logged: string[] = [];
    for (const options of [
      { migrate: false as const, migrationsFolder: "/migrations" },
      { migrate, migrationsFolder: null },
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: two boots, one after the other.
      const opened = await openDatabase({
        dataDir: "unused",
        env,
        log: (message) => logged.push(message),
        ...options,
      });
      if (opened.ok) {
        await opened.database.close();
      }
    }
    expect(migrate).not.toHaveBeenCalled();
    expect(logged.join("\n")).toContain("migrations weren't found");
  });
});
