import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "../testing";
import { createConversation } from "./conversations";
import { insertMessage } from "./messages";
import { createProviderKey } from "./provider-keys";
import { createRun } from "./runs";
import {
  budgetStatuses,
  exceededBudgets,
  getSpend,
  listBudgets,
  listTransactions,
  periodStart,
  recordTransaction,
  setBudget,
  summarizeUsage,
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

describe("summarizeUsage", () => {
  const day1 = new Date("2026-10-01T09:00:00Z");
  const day2 = new Date("2026-10-02T09:00:00Z");
  const before = new Date("2026-09-20T09:00:00Z");
  const range = {
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-10-03T00:00:00Z"),
  };

  /**
   * One user's spend: a titled chat in a sub-team paid by a team key, a
   * title call in the org on the instance's keys, and a call before the
   * range. A second user spends in the same sub-team.
   */
  const setup = async () => {
    const { db } = testDb;
    const ada = await seedUser(db, { name: "Ada" });
    const grace = await seedUser(db, { name: "Grace" });
    const org = await seedOrg(db, ada.id);
    const engineering = await seedTeam(db, org.id);
    const platform = await seedTeam(db, org.id, engineering.id);
    const elsewhere = await seedTeam(db, org.id);
    const context = { id: platform.id, type: "team" } as const;
    const chat = await createConversation(db, {
      context,
      ownerId: ada.id,
      title: "Quarterly plan",
    });
    const question = expectOk(
      await insertMessage(db, {
        authorId: ada.id,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "hi", type: "text" }],
        role: "user",
      })
    );
    const { run } = await createRun(db, {
      context,
      conversationId: chat.id,
      createdBy: ada.id,
      target: { model: "fast", type: "model" },
      userMessageId: question.id,
    });
    const key = await createProviderKey(db, {
      createdBy: ada.id,
      encryptedKey: "sealed",
      hint: "abcd",
      keyId: "k1",
      label: "Team Anthropic",
      provider: "anthropic",
      scope: { id: platform.id, type: "team" },
    });
    const record = (
      input: Partial<Parameters<typeof recordTransaction>[1]>,
      at: Date
    ) =>
      recordTransaction(
        db,
        {
          context,
          costMicros: 100,
          kind: "chat",
          model: "anthropic:claude-test",
          orgId: org.id,
          paidBy: { id: platform.id, type: "team" },
          usage: { inputTokens: 10, outputTokens: 5 },
          userId: ada.id,
          ...input,
        },
        at
      );
    await record({ costMicros: 300, runId: run.id }, day1);
    await record({ costMicros: 200, runId: run.id }, day2);
    await record(
      {
        context: { id: org.id, type: "org" },
        costMicros: 50,
        kind: "title",
        model: "ollama:qwen",
        paidBy: { type: "instance" },
      },
      day2
    );
    await record({ costMicros: 9000, runId: run.id }, before);
    await record({ costMicros: 70, userId: grace.id }, day1);
    await record(
      {
        context: { id: elsewhere.id, type: "team" },
        costMicros: 5,
        paidBy: { type: "instance" },
      },
      day1
    );
    return { ada, chat, db, engineering, key, org, platform };
  };

  test("groups by day, model, chat and key, within the range", async () => {
    const { ada, chat, db, key } = await setup();
    const mine = { type: "user", userId: ada.id } as const;
    const summarize = (
      groupBy: Parameters<typeof summarizeUsage>[2]["groupBy"]
    ) => summarizeUsage(db, mine, { ...range, groupBy });

    expect(
      (await summarize("day")).map((row) => [row.key, row.costMicros])
    ).toEqual([
      ["2026-10-01", 305],
      ["2026-10-02", 250],
    ]);
    expect(
      (await summarize("model")).map((row) => [row.key, row.costMicros])
    ).toEqual([
      ["anthropic:claude-test", 505],
      ["ollama:qwen", 50],
    ]);
    const byChat = await summarize("conversation");
    expect(byChat).toEqual([
      {
        costMicros: 500,
        key: chat.id,
        label: "Quarterly plan",
        usage: { inputTokens: 20, outputTokens: 10 },
      },
      {
        costMicros: 55,
        key: "",
        usage: { inputTokens: 20, outputTokens: 10 },
      },
    ]);
    const byKey = await summarize("key");
    expect(byKey.map((row) => [row.key, row.label, row.costMicros])).toEqual([
      [key.id, "Team Anthropic", 500],
      ["", undefined, 55],
    ]);
  });

  test("a space narrows to it and the spaces below it", async () => {
    const { ada, db, engineering, org, platform } = await setup();
    const everyone = { orgId: org.id, type: "org" } as const;
    const inTeam = (teamIds: readonly (typeof platform.id)[]) =>
      ({ teamIds, type: "team" }) as const;
    const total = async (
      filter: Parameters<typeof summarizeUsage>[1],
      space?: Parameters<typeof summarizeUsage>[2]["space"]
    ) =>
      (
        await summarizeUsage(db, filter, { ...range, groupBy: "user", space })
      ).map((row) => [row.label, row.costMicros]);

    expect(
      await total(everyone, inTeam([engineering.id, platform.id]))
    ).toEqual([
      ["Ada", 500],
      ["Grace", 70],
    ]);
    expect(
      await total({ type: "user", userId: ada.id }, inTeam([platform.id]))
    ).toEqual([["Ada", 500]]);
    expect(await total({ type: "user", userId: ada.id }, everyone)).toEqual([
      ["Ada", 555],
    ]);
  });

  test("a key narrows to the usage it paid for", async () => {
    const { ada, db, key } = await setup();
    const rows = await summarizeUsage(
      db,
      { type: "user", userId: ada.id },
      { ...range, groupBy: "model", keyId: key.id }
    );
    expect(rows.map((row) => [row.key, row.costMicros])).toEqual([
      ["anthropic:claude-test", 500],
    ]);
  });
});
