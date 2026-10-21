import { call } from "@orpc/server";
import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import type { StoredContext } from "@workspace/db/queries/conversations";
import { createConversation } from "@workspace/db/queries/conversations";
import { upsertGrant } from "@workspace/db/queries/grants";
import { insertMessage } from "@workspace/db/queries/messages";
import { createProviderKey } from "@workspace/db/queries/provider-keys";
import { createRun } from "@workspace/db/queries/runs";
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

  it("lets org admins cap one member in their org with `orgId`", async () => {
    const w = await seedWorld();
    const r = router();
    const capped = await call(
      r.setBudget,
      {
        limitMicros: 100,
        orgId: w.org.id,
        period: "month",
        principal: { id: w.plain.id, type: "user" },
      },
      as(w.owner.id)
    );
    // Their spend in this org's contexts, not their personal spend.
    expect(capped).toMatchObject({
      principal: { id: w.plain.id, type: "user" },
      usedMicros: 120,
    });
    expect(
      (await call(r.budgets, { orgId: w.org.id }, as(w.owner.id))).map(
        (each) => each.id
      )
    ).toContain(capped.id);
    // Not in the member's personal org.
    expect(
      await call(r.budgets, { orgId: w.plainPersonal.id }, as(w.plain.id))
    ).toEqual([]);

    // A principal from elsewhere, or a caller who doesn't run the org.
    const outsider = await seedUser(db);
    await expect(
      call(
        r.setBudget,
        {
          limitMicros: 1,
          orgId: w.org.id,
          period: "day",
          principal: { id: outsider.id, type: "user" },
        },
        as(w.owner.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      call(
        r.setBudget,
        {
          limitMicros: 1,
          orgId: w.org.id,
          period: "day",
          principal: { id: w.plainPersonal.id, type: "org" },
        },
        as(w.owner.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      call(
        r.setBudget,
        {
          limitMicros: 1,
          orgId: w.org.id,
          period: "day",
          principal: { id: w.plain.id, type: "user" },
        },
        as(w.plain.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  it("narrows your own usage to a space and the spaces below it", async () => {
    const w = await seedWorld();
    const mine = await call(
      router().summary,
      {
        ...RANGE,
        groupBy: "model",
        principalId: w.plain.id,
        principalType: "user",
        spaceId: w.parent.id,
        spaceType: "team",
      },
      as(w.plain.id)
    );
    expect(mine.totalCostMicros).toBe(120);
  });

  it("groups by chat only for your own usage", async () => {
    const w = await seedWorld();
    await expect(
      call(
        router().summary,
        {
          ...RANGE,
          groupBy: "conversation",
          principalId: w.org.id,
          principalType: "org",
        },
        as(w.owner.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("links people to their traces for instance admins only", async () => {
    const w = await seedWorld();
    const admin = await seedUser(db, { role: "admin" });
    await db
      .insert(member)
      .values({ organizationId: w.org.id, role: "admin", userId: admin.id });
    const traced = createUsageRouter({
      db,
      userTracesUrl: (userId) => `https://traces.test/users/${userId}`,
    }).usage;
    const input = {
      ...RANGE,
      groupBy: "user",
      principalId: w.org.id,
      principalType: "org",
    } as const;

    const forAdmin = await call(traced.summary, input, as(admin.id));
    expect(forAdmin.rows.map((row) => row.traceUrl)).toContain(
      `https://traces.test/users/${w.plain.id}`
    );
    const forOwner = await call(traced.summary, input, as(w.owner.id));
    expect(forOwner.rows.every((row) => row.traceUrl === undefined)).toBe(true);
  });
});

describe("names in usage", () => {
  /**
   * Ada owns an org; Ben administers one of its teams; Cy is a plain member
   * of that team. Cy spends in the team on the team's key, the org's key and
   * his own key.
   */
  const seedKeys = async () => {
    const ada = await seedUser(db);
    const ben = await seedUser(db);
    const cy = await seedUser(db);
    const org = await seedOrg(db, ada.id);
    await db.insert(member).values([
      { organizationId: org.id, role: "member", userId: ben.id },
      { organizationId: org.id, role: "member", userId: cy.id },
    ]);
    const crew = await seedTeam(db, org.id);
    await db.insert(teamMember).values([
      { role: "admin", teamId: crew.id, userId: ben.id },
      { role: "member", teamId: crew.id, userId: cy.id },
    ]);
    const key = (
      scope: { readonly id: string; readonly type: "user" | "team" | "org" },
      provider: "anthropic" | "openai",
      label: string
    ) =>
      createProviderKey(db, {
        createdBy: ada.id,
        encryptedKey: "sealed",
        hint: "abcd",
        keyId: "k1",
        label,
        provider,
        scope: scope as Parameters<typeof createProviderKey>[1]["scope"],
      });
    const teamKey = await key(
      { id: crew.id, type: "team" },
      "anthropic",
      "Crew key"
    );
    const orgKey = await key({ id: org.id, type: "org" }, "openai", "Org key");
    const ownKey = await key(
      { id: cy.id, type: "user" },
      "anthropic",
      "Cy's key"
    );
    const context = { id: crew.id, type: "team" } as const;
    const pay = (
      paidBy: Parameters<typeof recordTransaction>[1]["paidBy"],
      model: string
    ) =>
      recordTransaction(db, {
        context,
        costMicros: 10,
        kind: "chat",
        model,
        orgId: org.id,
        paidBy,
        usage: { inputTokens: 1, outputTokens: 1 },
        userId: cy.id,
      });
    await pay({ id: crew.id, type: "team" }, "anthropic:claude-test");
    await pay({ id: org.id, type: "org" }, "openai:gpt-test");
    await pay({ id: cy.id, type: "user" }, "anthropic:claude-test");
    return { ada, ben, crew, cy, org, orgKey, ownKey, teamKey };
  };

  const labels = (summary: {
    readonly rows: readonly { key: string; label?: string }[];
  }) => Object.fromEntries(summary.rows.map((row) => [row.key, row.label]));

  it("names only the keys the caller could list", async () => {
    const w = await seedKeys();
    const byKey = (
      principalId: string,
      principalType: "user" | "team" | "org",
      userId: UserId
    ) =>
      call(
        router().summary,
        {
          ...RANGE,
          groupBy: "key",
          principalId: principalId as UserId,
          principalType,
        },
        as(userId)
      );

    expect(labels(await byKey(w.cy.id, "user", w.cy.id))).toEqual({
      [w.orgKey.id]: undefined,
      [w.ownKey.id]: "Cy's key",
      [w.teamKey.id]: undefined,
    });
    expect(labels(await byKey(w.crew.id, "team", w.ben.id))).toEqual({
      [w.orgKey.id]: undefined,
      [w.ownKey.id]: undefined,
      [w.teamKey.id]: "Crew key",
    });
    expect(labels(await byKey(w.org.id, "org", w.ada.id))).toEqual({
      [w.orgKey.id]: "Org key",
      [w.ownKey.id]: undefined,
      [w.teamKey.id]: "Crew key",
    });
  });

  it("titles only the chats the caller can still read", async () => {
    const w = await seedKeys();
    const context = { id: w.crew.id, type: "team" } as const;
    const chatBy = async (
      ownerId: UserId,
      title: string | null
    ): Promise<ConversationId> => {
      const chat = await createConversation(db, { context, ownerId, title });
      const question = await insertMessage(db, {
        authorId: ownerId,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "hi", type: "text" }],
        role: "user",
      });
      if (!question.ok) {
        throw new Error("no message");
      }
      const { run } = await createRun(db, {
        context,
        conversationId: chat.id,
        createdBy: w.cy.id,
        target: { model: "fast", type: "model" },
        userMessageId: question.value.id,
      });
      await recordTransaction(db, {
        context,
        costMicros: 1,
        kind: "chat",
        model: "anthropic:claude-test",
        orgId: w.org.id,
        paidBy: { type: "instance" },
        runId: run.id,
        usage: { inputTokens: 1, outputTokens: 1 },
        userId: w.cy.id,
      });
      return chat.id;
    };
    const mine = await chatBy(w.cy.id, "Cy's plan");
    const untitled = await chatBy(w.cy.id, null);
    const shared = await chatBy(w.ada.id, "Shared plan");
    const lost = await chatBy(w.ada.id, "Ada's secret");
    await upsertGrant(db, {
      grantedBy: w.ada.id,
      permission: "viewer",
      principal: { id: w.cy.id, type: "user" },
      resource: { resourceId: shared, resourceType: "conversation" },
    });

    const byChat = await call(
      router().summary,
      {
        ...RANGE,
        groupBy: "conversation",
        principalId: w.cy.id,
        principalType: "user",
      },
      as(w.cy.id)
    );
    const named = labels(byChat);
    expect(named[mine]).toBe("Cy's plan");
    expect(named[shared]).toBe("Shared plan");
    // `""` is a chat the caller reads that has no title yet.
    expect(named[untitled]).toBe("");
    expect(lost in named).toBe(true);
    expect(named[lost]).toBeUndefined();
  });
});
