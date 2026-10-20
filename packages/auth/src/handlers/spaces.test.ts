import { call, ORPCError } from "@orpc/server";
import type {
  LibraryItemId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import { recordTransaction } from "@workspace/db/queries/usage";
import { agent } from "@workspace/db/schema/library";
import { providerKey } from "@workspace/db/schema/usage";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestAuth,
  type SignedIn,
  signUp,
  type TestAuth,
} from "../testing";
import { type HandlerContext, resolveSession } from "./context";
import { authRouter } from "./index";

// Spaces (ticket 187) through the handlers, on PGlite: what each member
// sees, who manages what, allowances and usage per key.

let current: TestAuth | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

const contextOf = async (
  t: TestAuth,
  who: SignedIn
): Promise<HandlerContext> => ({
  appUrl: "https://chat.example.test",
  auth: t.auth,
  config: t.config,
  db: t.db,
  headers: who.headers,
  session: await resolveSession(t.auth, who.headers),
});

const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected the procedure to fail");
};

const team = (id: TeamId) => ({ id, type: "team" as const });

/** Acme › Design › Brand and Acme › Engineering; Bo is in Brand, Cy in Engineering. */
const acme = async () => {
  current = await createTestAuth();
  const t = current;
  const owner = await signUp(t.auth, "owner@example.test", "Owner");
  const ctx = await contextOf(t, owner);
  const org = await call(
    authRouter.orgs.create,
    { name: "Acme", slug: "acme" },
    { context: ctx }
  );
  const root = { id: org.id, type: "org" as const };
  const design = await call(
    authRouter.spaces.createChild,
    { ...root, name: "Design" },
    { context: ctx }
  );
  const brand = await call(
    authRouter.spaces.createChild,
    { ...team(design.id as TeamId), name: "Brand" },
    { context: ctx }
  );
  const eng = await call(
    authRouter.spaces.createChild,
    { ...root, name: "Engineering" },
    { context: ctx }
  );
  const joinAs = async (email: string, name: string, teamId: TeamId) => {
    const invitation = await call(
      authRouter.orgs.invite,
      { email, orgId: org.id, role: "member", teamIds: [teamId] },
      { context: ctx }
    );
    const who = await signUp(t.auth, email, name);
    const whoCtx = await contextOf(t, who);
    await call(
      authRouter.orgs.acceptInvitation,
      { token: invitation.token ?? "" },
      { context: whoCtx }
    );
    return { ctx: whoCtx, id: who.userId };
  };
  const bo = await joinAs("bo@example.test", "Bo", brand.id as TeamId);
  const cy = await joinAs("cy@example.test", "Cy", eng.id as TeamId);
  return {
    bo,
    brand: team(brand.id as TeamId),
    ctx,
    cy,
    design: team(design.id as TeamId),
    eng: team(eng.id as TeamId),
    orgId: org.id as OrgId,
    owner,
    root,
    t,
  };
};

const anAgent = async (t: TestAuth, ownerId: UserId, name: string) => {
  const [row] = await t.db
    .insert(agent)
    .values({ createdBy: ownerId, name, ownerId, ownerType: "user" })
    .returning();
  return row?.id as LibraryItemId;
};

describe("spaces.list", () => {
  it("shows the personal space, then the tree with each member's place in it", async () => {
    const { bo } = await acme();
    const spaces = await call(authRouter.spaces.list, undefined, {
      context: bo.ctx,
    });
    expect(spaces.map((s) => [s.name, s.access, s.myRole])).toEqual([
      [expect.any(String), "member", "owner"],
      ["Acme", "member", "member"],
      ["Design", "root_member", null],
      ["Brand", "member", "member"],
      ["Engineering", "root_member", null],
    ]);
  });
});

describe("spaces.content", () => {
  it("flows down to sub-spaces, never up or sideways", async () => {
    const { bo, cy, ctx, design, brand, eng, owner, t } = await acme();
    const ownerId = owner.userId;
    const guide = await anAgent(t, ownerId, "Brand guide");
    const style = await anAgent(t, ownerId, "Logo checker");
    await call(
      authRouter.spaces.share,
      { ...design, resourceId: guide, resourceType: "agent" },
      { context: ctx }
    );
    await call(
      authRouter.spaces.share,
      { ...brand, resourceId: style, resourceType: "agent" },
      { context: ctx }
    );

    const inBrand = await call(authRouter.spaces.content, brand, {
      context: bo.ctx,
    });
    expect(inBrand.map((item) => [item.title, item.sharedInName])).toEqual([
      ["Logo checker", "Brand"],
      ["Brand guide", "Design"],
    ]);
    // Bo reaches Design's content through Brand, but not Brand's from Design.
    const inDesign = await call(authRouter.spaces.content, design, {
      context: bo.ctx,
    });
    expect(inDesign.map((item) => item.title)).toEqual(["Brand guide"]);
    // Cy, in Engineering, sees neither.
    expect(
      await call(authRouter.spaces.content, design, { context: cy.ctx })
    ).toEqual([]);
    expect(
      await call(authRouter.spaces.content, eng, { context: cy.ctx })
    ).toEqual([]);
  });

  it("refuses to share what the caller doesn't own", async () => {
    const { bo, brand, owner, t } = await acme();
    const theirs = await anAgent(t, owner.userId, "Private");
    expect(
      await failure(
        call(
          authRouter.spaces.share,
          { ...brand, resourceId: theirs, resourceType: "agent" },
          { context: bo.ctx }
        )
      )
    ).toBe("FORBIDDEN");
  });
});

describe("spaces members", () => {
  it("lets a sub-space owner promote people into it, and nothing beside it", async () => {
    const { bo, cy, ctx, brand, eng } = await acme();
    await call(
      authRouter.spaces.setMember,
      { ...brand, role: "owner", userId: bo.id },
      { context: ctx }
    );
    const added = await call(
      authRouter.spaces.setMember,
      { ...brand, role: "member", userId: cy.id },
      { context: bo.ctx }
    );
    expect(added).toMatchObject({ role: "member", user: { id: cy.id } });
    expect(
      await failure(
        call(
          authRouter.spaces.setMember,
          { ...eng, role: "member", userId: bo.id },
          { context: bo.ctx }
        )
      )
    ).toBe("FORBIDDEN");
    const members = await call(authRouter.spaces.members, brand, {
      context: cy.ctx,
    });
    expect(members.map((m) => [m.user.name, m.role])).toEqual([
      ["Bo", "owner"],
      ["Cy", "member"],
    ]);
  });
});

describe("spaces allowance", () => {
  it("lets a member draw on the pool once an owner approves", async () => {
    const { bo, ctx, brand, orgId, t } = await acme();
    await call(
      authRouter.spaces.setAllowance,
      { ...brand, monthlyTokens: 10_000 },
      { context: ctx }
    );
    const asked = await call(
      authRouter.spaces.requestAllowance,
      { ...brand, monthlyTokens: 4000, note: "Campaign drafts" },
      { context: bo.ctx }
    );
    expect(asked.status).toBe("pending");
    let mine = await call(authRouter.spaces.allowance, brand, {
      context: bo.ctx,
    });
    expect(mine.myRemainingTokens).toBe(0);

    expect(
      await failure(
        call(
          authRouter.spaces.decideAllowance,
          { ...brand, decision: "approved", grantId: asked.id },
          { context: bo.ctx }
        )
      )
    ).toBe("FORBIDDEN");
    await call(
      authRouter.spaces.decideAllowance,
      { ...brand, decision: "approved", grantId: asked.id },
      { context: ctx }
    );
    await recordTransaction(t.db, {
      context: { id: brand.id, type: "team" },
      costMicros: 10,
      kind: "chat",
      model: "anthropic:claude-test",
      orgId,
      paidBy: { id: brand.id, type: "team" },
      usage: { inputTokens: 700, outputTokens: 300 },
      userId: bo.id,
    });
    mine = await call(authRouter.spaces.allowance, brand, { context: bo.ctx });
    expect(mine).toMatchObject({
      monthlyTokens: 10_000,
      myRemainingTokens: 3000,
      usedTokens: 1000,
    });
    expect(mine.grants).toHaveLength(1);
  });
});

describe("spaces.keyUsage", () => {
  it("attributes usage to the key that paid", async () => {
    const { bo, ctx, brand, orgId, owner, t } = await acme();
    const [key] = await t.db
      .insert(providerKey)
      .values({
        createdBy: owner.userId,
        encryptedKey: "sealed",
        hint: "abcd",
        keyId: "k1",
        label: "Brand team key",
        provider: "anthropic",
        scopeId: brand.id,
        scopeType: "team",
      })
      .returning();
    for (const tokens of [100, 250]) {
      // biome-ignore lint/performance/noAwaitInLoops: two rows in order, so the test reads like the usage it records
      await recordTransaction(t.db, {
        context: { id: brand.id, type: "team" },
        costMicros: tokens,
        kind: "chat",
        model: "anthropic:claude-test",
        orgId,
        paidBy: { id: brand.id, type: "team" },
        usage: { inputTokens: tokens, outputTokens: 0 },
        userId: bo.id,
      });
    }
    const usage = await call(authRouter.spaces.keyUsage, brand, {
      context: ctx,
    });
    expect(usage.rows).toEqual([
      expect.objectContaining({
        costMicros: 350,
        createdBy: expect.objectContaining({ name: "Owner" }),
        keyId: key?.id,
        label: "Brand team key",
        tokens: 350,
        transactions: 2,
      }),
    ]);
    expect(
      await failure(
        call(authRouter.spaces.keyUsage, brand, { context: bo.ctx })
      )
    ).toBe("FORBIDDEN");
  });
});
