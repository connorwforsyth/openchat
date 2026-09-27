import { call } from "@orpc/server";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import type { StoredContext } from "@workspace/db/queries/conversations";
import { recordTransaction } from "@workspace/db/queries/usage";
import { member } from "@workspace/db/schema/auth";
import { teamMember } from "@workspace/db/schema/tenancy";
import {
  createTestDb,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUsageRouter } from "./usage";

// Usage and budgets through the `usage` procedures, called in-process.

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

const router = () => createUsageRouter({ db }).usage;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const RANGE = {
  from: "2000-01-01T00:00:00.000Z",
  to: "2100-01-01T00:00:00.000Z",
};

const seedWorld = async () => {
  const owner = await seedUser(db);
  const teamAdmin = await seedUser(db);
  const plain = await seedUser(db);
  const org = await seedOrg(db, owner.id);
  const plainPersonal = await seedOrg(db, plain.id, { isPersonal: true });
  await db.insert(member).values([
    { organizationId: org.id, role: "member", userId: teamAdmin.id },
    { organizationId: org.id, role: "member", userId: plain.id },
  ]);
  const parent = await seedTeam(db, org.id);
  const child = await seedTeam(db, org.id, parent.id);
  const other = await seedTeam(db, org.id);
  await db
    .insert(teamMember)
    .values({ role: "admin", teamId: parent.id, userId: teamAdmin.id });

  const spend = (
    userId: UserId,
    context: StoredContext,
    orgId: typeof org.id,
    costMicros: number,
    model = "anthropic:claude-test"
  ) =>
    recordTransaction(db, {
      context,
      costMicros,
      kind: "chat",
      model,
      orgId,
      paidBy: { type: "instance" },
      usage: { inputTokens: 10, outputTokens: 5 },
      userId,
    });
  await spend(plain.id, { id: child.id, type: "team" }, org.id, 100);
  await spend(
    plain.id,
    { id: parent.id, type: "team" },
    org.id,
    20,
    "openai:gpt-test"
  );
  await spend(owner.id, { id: other.id, type: "team" }, org.id, 3);
  await spend(owner.id, { id: org.id, type: "org" }, org.id, 50);
  await spend(
    plain.id,
    { id: plainPersonal.id, type: "personal" },
    plainPersonal.id,
    7
  );
  return { child, org, other, owner, parent, plain, plainPersonal, teamAdmin };
};

describe("usage procedures", () => {
  it("needs a session", async () => {
    await expect(
      call(
        router().summary,
        {
          ...RANGE,
          principalId: (await seedUser(db)).id,
          principalType: "user",
        },
        as(null)
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rolls team totals up from sub-teams and org totals from everything", async () => {
    const w = await seedWorld();
    const r = router();
    const team = await call(
      r.summary,
      { ...RANGE, principalId: w.parent.id, principalType: "team" },
      as(w.teamAdmin.id)
    );
    expect(team.totalCostMicros).toBe(120);
    expect(team.principal).toEqual({ id: w.parent.id, type: "team" });
    expect(team.rows.map((row) => [row.key, row.costMicros])).toEqual([
      ["anthropic:claude-test", 100],
      ["openai:gpt-test", 20],
    ]);
    expect(team.rows[0]?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    const org = await call(
      r.summary,
      {
        ...RANGE,
        groupBy: "user",
        principalId: w.org.id,
        principalType: "org",
      },
      as(w.owner.id)
    );
    expect(org.totalCostMicros).toBe(173);
    expect(
      Object.fromEntries(org.rows.map((row) => [row.key, row.costMicros]))
    ).toEqual({
      [w.owner.id]: 53,
      [w.plain.id]: 120,
    });
  });

  it("shows a user their own spend everywhere, and nobody else's", async () => {
    const w = await seedWorld();
    const r = router();
    const mine = await call(
      r.summary,
      {
        ...RANGE,
        groupBy: "day",
        principalId: w.plain.id,
        principalType: "user",
      },
      as(w.plain.id)
    );
    expect(mine.totalCostMicros).toBe(127);
    expect(mine.rows[0]?.key).toMatch(ISO_DATE);

    const refusals = [
      {
        principalId: w.plain.id,
        principalType: "user" as const,
        userId: w.owner.id,
      },
      {
        principalId: w.org.id,
        principalType: "org" as const,
        userId: w.plain.id,
      },
      {
        principalId: w.org.id,
        principalType: "org" as const,
        userId: w.teamAdmin.id,
      },
      {
        principalId: w.parent.id,
        principalType: "team" as const,
        userId: w.plain.id,
      },
      {
        principalId: w.other.id,
        principalType: "team" as const,
        userId: w.teamAdmin.id,
      },
    ];
    await Promise.all(
      refusals.flatMap(({ userId, ...principal }) => [
        expect(
          call(r.summary, { ...RANGE, ...principal }, as(userId))
        ).rejects.toMatchObject({ code: "FORBIDDEN" }),
        expect(
          call(r.transactions, principal, as(userId))
        ).rejects.toMatchObject({ code: "FORBIDDEN" }),
      ])
    );
  });

  it("pages transactions newest first", async () => {
    const w = await seedWorld();
    const r = router();
    const first = await call(
      r.transactions,
      { limit: 2, principalId: w.plain.id, principalType: "user" },
      as(w.plain.id)
    );
    expect(first.items.map((item) => item.costMicros)).toEqual([7, 20]);
    expect(first.items[0]?.context).toEqual({ type: "personal" });
    expect(first.items[0]?.paidBy).toEqual({ type: "instance" });
    expect(first.nextCursor).not.toBeNull();
    const second = await call(
      r.transactions,
      {
        cursor: first.nextCursor ?? undefined,
        limit: 2,
        principalId: w.plain.id,
        principalType: "user",
      },
      as(w.plain.id)
    );
    expect(second.items.map((item) => item.costMicros)).toEqual([100]);
    expect(second.nextCursor).toBeNull();
    await expect(
      call(
        r.transactions,
        { cursor: "nope", principalId: w.plain.id, principalType: "user" },
        as(w.plain.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("lets org admins manage budgets, with this period's spend", async () => {
    const w = await seedWorld();
    const r = router();
    const orgBudget = await call(
      r.setBudget,
      {
        limitMicros: 1000,
        period: "month",
        principal: { id: w.org.id, type: "org" },
      },
      as(w.owner.id)
    );
    expect(orgBudget).toMatchObject({
      hard: true,
      limitMicros: 1000,
      period: "month",
      principal: { id: w.org.id, type: "org" },
      usedMicros: 173,
    });
    const teamBudget = await call(
      r.setBudget,
      {
        hard: false,
        limitMicros: 500,
        period: "week",
        principal: { id: w.parent.id, type: "team" },
      },
      as(w.owner.id)
    );
    expect(teamBudget.usedMicros).toBe(120);

    // Team admins don't set their own caps.
    await expect(
      call(
        r.setBudget,
        {
          limitMicros: 1,
          period: "day",
          principal: { id: w.parent.id, type: "team" },
        },
        as(w.teamAdmin.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(r.budgets, { orgId: w.org.id }, as(w.plain.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const listed = await call(r.budgets, { orgId: w.org.id }, as(w.owner.id));
    expect(listed.map((each) => each.id).sort()).toEqual(
      [orgBudget.id, teamBudget.id].sort()
    );

    await expect(
      call(r.deleteBudget, { id: orgBudget.id }, as(w.plain.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await call(r.deleteBudget, { id: orgBudget.id }, as(w.owner.id));
    expect(
      (await call(r.budgets, { orgId: w.org.id }, as(w.owner.id))).map(
        (each) => each.id
      )
    ).toEqual([teamBudget.id]);
  });

  it("lets a user cap their own personal spend, and only theirs", async () => {
    const w = await seedWorld();
    const r = router();
    const own = await call(
      r.setBudget,
      {
        limitMicros: 5,
        period: "day",
        principal: { id: w.plain.id, type: "user" },
      },
      as(w.plain.id)
    );
    expect(own.usedMicros).toBe(7);
    expect(
      await call(r.budgets, { orgId: w.plainPersonal.id }, as(w.plain.id))
    ).toHaveLength(1);
    await expect(
      call(
        r.setBudget,
        {
          limitMicros: 5,
          period: "day",
          principal: { id: w.plain.id, type: "user" },
        },
        as(w.owner.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
