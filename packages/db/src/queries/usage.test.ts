import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "../testing";
import {
  budgetStatuses,
  exceededBudgets,
  getSpend,
  listBudgets,
  listTransactions,
  periodStart,
  recordTransaction,
  setBudget,
} from "./usage";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

describe("periodStart", () => {
  test("day, ISO week and month boundaries in UTC", () => {
    // A Sunday, late in the day UTC.
    const now = new Date("2026-09-27T23:30:00Z");
    expect(periodStart("day", now).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z"
    );
    expect(periodStart("week", now).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z"
    );
    expect(
      periodStart("week", new Date("2026-09-21T00:00:00Z")).toISOString()
    ).toBe("2026-09-21T00:00:00.000Z");
    expect(periodStart("month", now).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z"
    );
  });
});

describe("recordTransaction and budgets", () => {
  test("spend rolls up from a sub-team to its parents and the org", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const org = await seedOrg(db, user.id);
    const engineering = await seedTeam(db, org.id);
    const platform = await seedTeam(db, org.id, engineering.id);
    const now = new Date("2026-09-27T12:00:00Z");
    const record = (costMicros: number, at = now) =>
      recordTransaction(
        db,
        {
          context: { id: platform.id, type: "team" },
          costMicros,
          kind: "chat",
          model: "anthropic:claude-test",
          orgId: org.id,
          paidBy: { id: org.id, type: "org" },
          usage: { inputTokens: 100, outputTokens: 50 },
          userId: user.id,
        },
        at
      );
    await record(1500);
    await record(500);
    await record(9000, new Date("2026-08-01T12:00:00Z"));

    for (const principal of [
      { id: user.id, type: "user" },
      { id: platform.id, type: "team" },
      { id: engineering.id, type: "team" },
      { id: org.id, type: "org" },
    ] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of reads, clearer in order.
      expect(await getSpend(db, org.id, principal, "month", now)).toBe(2000);
    }
    expect(
      await getSpend(db, org.id, { id: user.id, type: "user" }, "day", now)
    ).toBe(2000);

    await setBudget(db, {
      hard: true,
      limitMicros: 1000,
      orgId: org.id,
      period: "month",
      principal: { id: engineering.id, type: "team" },
    });
    await setBudget(db, {
      hard: false,
      limitMicros: 5000,
      orgId: org.id,
      period: "day",
      principal: { id: user.id, type: "user" },
    });
    // Setting again replaces.
    await setBudget(db, {
      hard: true,
      limitMicros: 1800,
      orgId: org.id,
      period: "month",
      principal: { id: engineering.id, type: "team" },
    });
    expect(await listBudgets(db, org.id)).toHaveLength(2);

    const statuses = await budgetStatuses(
      db,
      org.id,
      [
        { id: user.id, type: "user" },
        { id: platform.id, type: "team" },
        { id: engineering.id, type: "team" },
        { id: org.id, type: "org" },
      ],
      now
    );
    expect(statuses).toHaveLength(2);
    const exceeded = exceededBudgets(statuses);
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0]).toMatchObject({
      hard: true,
      limitMicros: 1800,
      usedMicros: 2000,
    });
    expect(exceeded[0]?.resetsAt.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z"
    );
    expect(await budgetStatuses(db, org.id, [])).toEqual([]);

    const page = expectOk(await listTransactions(db, user.id, { limit: 2 }));
    expect(page.items).toHaveLength(2);
    const rest = expectOk(
      await listTransactions(db, user.id, {
        cursor: page.nextCursor ?? undefined,
        limit: 2,
      })
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  test("an instance key records no payer id", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const personal = await seedOrg(db, user.id, { isPersonal: true });
    const row = await recordTransaction(db, {
      context: { id: personal.id, type: "personal" },
      costMicros: 0,
      kind: "title",
      model: "ollama:llama3",
      orgId: personal.id,
      paidBy: { type: "instance" },
      usage: { inputTokens: 1, outputTokens: 1 },
      userId: user.id,
    });
    expect(row).toMatchObject({ paidById: null, paidByType: "instance" });
  });
});
