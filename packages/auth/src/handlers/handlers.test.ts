import { call, ORPCError } from "@orpc/server";
import type {
  ConversationId,
  LibraryItemId,
  OrgId,
  TeamId,
} from "@workspace/contract/schemas/common";
import type { SharedResource } from "@workspace/contract/schemas/grants";
import { conversation } from "@workspace/db/schema/chat";
import { agent } from "@workspace/db/schema/library";
import { invitationToken } from "@workspace/db/schema/tenancy";
import { afterEach, describe, expect, it } from "vitest";

import { checkAccess } from "../resources";
import {
  createTestAuth,
  type SignedIn,
  signUp,
  type TestAuth,
} from "../testing";
import { type HandlerContext, resolveSession } from "./context";
import { authRouter } from "./index";

let current: TestAuth | undefined;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

const setup = async (
  auth: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) => {
  current = await createTestAuth(auth, overrides);
  return current;
};

const contextOf = async (
  t: TestAuth,
  who: SignedIn | null,
  extra: Partial<HandlerContext> = {}
): Promise<HandlerContext> => {
  const headers = who?.headers ?? new Headers();
  return {
    appUrl: "https://chat.example.test",
    auth: t.auth,
    config: t.config,
    db: t.db,
    headers,
    session: who ? await resolveSession(t.auth, headers) : null,
    ...extra,
  };
};

/** The typed error a procedure threw: its code and, for `CONFLICT`, the reason. */
const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ORPCError) {
      const reason = (error.data as { reason?: string } | undefined)?.reason;
      return reason ? `${error.code}:${reason}` : error.code;
    }
    throw error;
  }
  throw new Error("expected the procedure to fail");
};

/** Signs up the first user (the admin) and an org they own with Eng › Platform. */
const orgWithTree = async (t: TestAuth) => {
  const admin = await signUp(t.auth, "admin@example.test");
  const ctx = await contextOf(t, admin);
  const org = await call(
    authRouter.orgs.create,
    { name: "Acme", slug: "acme" },
    { context: ctx }
  );
  const eng = await call(
    authRouter.teams.create,
    { name: "Eng", orgId: org.id, parentId: null },
    { context: ctx }
  );
  const platform = await call(
    authRouter.teams.create,
    { name: "Platform", orgId: org.id, parentId: eng.id },
    { context: ctx }
  );
  return { admin, ctx, eng, org, platform };
};

/** The invite link's token, which only `invite`'s response carries. */
const tokenOf = (invitation: { readonly token?: string }): string => {
  if (!invitation.token) {
    throw new Error("invite returned no token");
  }
  return invitation.token;
};

/** Invites `email` into the org (and teams), signs them up and accepts. */
const join = async (
  t: TestAuth,
  adminCtx: HandlerContext,
  orgId: OrgId,
  email: string,
  teamIds: TeamId[] = []
) => {
  const invitation = await call(
    authRouter.orgs.invite,
    { email, orgId, role: "member", teamIds },
    { context: adminCtx }
  );
  const who = await signUp(t.auth, email);
  const ctx = await contextOf(t, who);
  await call(
    authRouter.orgs.acceptInvitation,
    { token: tokenOf(invitation) },
    { context: ctx }
  );
  return { ctx, who };
};

describe("me", () => {
  it("shows the personal org and admin status", async () => {
    const t = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    const me = await call(authRouter.me.get, undefined, {
      context: await contextOf(t, ada),
    });
    expect(me.user).toMatchObject({ email: "ada@example.test", isAdmin: true });
    expect(me.orgs).toEqual([
      expect.objectContaining({
        id: me.personalOrgId,
        isPersonal: true,
        myRole: "owner",
      }),
    ]);
  });

  it("turns off the persisted client cache when an org or the instance does", async () => {
    const t = await setup();
    const { ctx, org } = await orgWithTree(t);
    const bob = await join(t, ctx, org.id, "bob@example.test");
    const persists = async (context: HandlerContext) =>
      (await call(authRouter.me.get, undefined, { context }))
        .persistClientCache;
    expect(await persists(bob.ctx)).toBe(true);

    const view = await call(
      authRouter.orgs.updatePolicy,
      { id: org.id, policy: { persistClientCache: false } },
      { context: ctx }
    );
    expect(view.effective.persistClientCache).toBe(false);
    expect(await persists(bob.ctx)).toBe(false);

    await t.close();
    const forbidding = await setup(
      {},
      { policies: { persistClientCache: "forbidden" } }
    );
    const solo = await signUp(forbidding.auth, "solo@example.test");
    expect(await persists(await contextOf(forbidding, solo))).toBe(false);
  });

  it("needs a session", async () => {
    const t = await setup();
    expect(
      await failure(
        call(authRouter.me.get, undefined, {
          context: await contextOf(t, null),
        })
      )
    ).toBe("UNAUTHORIZED");
  });

  it("keeps settings, and refuses a context the user isn't in", async () => {
    const t = await setup();
    const { ctx, eng } = await orgWithTree(t);
    expect(
      await call(
        authRouter.me.updateSettings,
        { locale: "en-GB" },
        { context: ctx }
      )
    ).toEqual({
      defaultContext: { type: "personal" },
      defaultTarget: null,
      locale: "en-GB",
      shortcuts: {},
    });
    const shortcuts = { "chat.new": ["Mod+Shift+O"], "settings.open": [] };
    expect(
      await call(authRouter.me.updateSettings, { shortcuts }, { context: ctx })
    ).toMatchObject({ locale: "en-GB", shortcuts });
    expect(
      await call(authRouter.me.settings, undefined, { context: ctx })
    ).toMatchObject({ shortcuts });
    expect(
      await failure(
        call(
          authRouter.me.updateSettings,
          { defaultContext: { id: eng.id, type: "team" } },
          { context: ctx }
        )
      )
    ).toBe("FORBIDDEN");
  });
});

describe("orgs", () => {
  it("creates, lists (without the personal org) and rejects a taken slug", async () => {
    const t = await setup();
    const { ctx, org } = await orgWithTree(t);
    expect(org).toMatchObject({
      isPersonal: false,
      myRole: "owner",
      slug: "acme",
    });
    expect(
      await call(authRouter.orgs.list, undefined, { context: ctx })
    ).toEqual([org]);
    expect(
      await failure(
        call(
          authRouter.orgs.create,
          { name: "Again", slug: "acme" },
          { context: ctx }
        )
      )
    ).toBe("CONFLICT:already_exists");
  });

  it("invites into teams: accepting joins the org and those teams", async () => {
    const t = await setup();
    const { ctx, org, platform } = await orgWithTree(t);
    const bob = await join(t, ctx, org.id, "bob@example.test", [platform.id]);

    const me = await call(authRouter.me.get, undefined, { context: bob.ctx });
    expect(me.orgs.map((each) => each.id)).toContain(org.id);
    expect(me.teams).toEqual([
      { role: "member", team: expect.objectContaining({ id: platform.id }) },
    ]);
    const invitations = await call(
      authRouter.orgs.listInvitations,
      { orgId: org.id },
      { context: ctx }
    );
    expect(invitations).toEqual([
      expect.objectContaining({ status: "accepted", teamIds: [platform.id] }),
    ]);
  });

  it("takes an invitation only with its one-time token and the invited address", async () => {
    const t = await setup({ signup: "open" });
    const { ctx, org } = await orgWithTree(t);
    const first = await call(
      authRouter.orgs.invite,
      { email: "bob@example.test", orgId: org.id, role: "member", teamIds: [] },
      { context: ctx }
    );
    const second = await call(
      authRouter.orgs.invite,
      { email: "cy@example.test", orgId: org.id, role: "member", teamIds: [] },
      { context: ctx }
    );
    const token = tokenOf(first);
    expect(token).not.toBe(tokenOf(second));
    // Stored hashed: never listed, never in the database as given.
    const listed = await call(
      authRouter.orgs.listInvitations,
      { orgId: org.id },
      { context: ctx }
    );
    expect(listed.map((each) => each.id).sort()).toEqual(
      [first.id, second.id].sort()
    );
    expect(listed.every((each) => each.token === undefined)).toBe(true);
    const stored = await t.db.select().from(invitationToken);
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.tokenHash)).not.toContain(token);

    const eve = await contextOf(t, await signUp(t.auth, "eve@example.test"));
    expect(
      await failure(
        call(authRouter.orgs.acceptInvitation, { token }, { context: eve })
      )
    ).toBe("FORBIDDEN");

    const bob = await contextOf(t, await signUp(t.auth, "bob@example.test"));
    expect(
      await failure(
        call(
          authRouter.orgs.acceptInvitation,
          { token: "x".repeat(43) },
          { context: bob }
        )
      )
    ).toBe("NOT_FOUND");
    expect(
      await call(authRouter.orgs.acceptInvitation, { token }, { context: bob })
    ).toMatchObject({ id: org.id, myRole: "member" });
    // Used up.
    expect(
      await failure(
        call(authRouter.orgs.acceptInvitation, { token }, { context: bob })
      )
    ).toBe("NOT_FOUND");
  });

  it("still accepts by the (deprecated) invitation id for one release", async () => {
    const t = await setup({ signup: "open" });
    const { ctx, org } = await orgWithTree(t);
    const invited = await call(
      authRouter.orgs.invite,
      { email: "cy@example.test", orgId: org.id, role: "member", teamIds: [] },
      { context: ctx }
    );
    // v4, not v7, while an id can still accept.
    expect(invited.id).toMatch(UUID_V4);
    const cy = await contextOf(t, await signUp(t.auth, "cy@example.test"));
    expect(
      await call(
        authRouter.orgs.acceptInvitation,
        { id: invited.id },
        { context: cy }
      )
    ).toMatchObject({ id: org.id, myRole: "member" });
  });

  it("hides an org from non-members and keeps members from admin work", async () => {
    const t = await setup({ signup: "open" });
    const { ctx, org } = await orgWithTree(t);
    const stranger = await contextOf(
      t,
      await signUp(t.auth, "stranger@example.test")
    );
    expect(
      await failure(
        call(authRouter.orgs.get, { id: org.id }, { context: stranger })
      )
    ).toBe("NOT_FOUND");

    const bob = await join(t, ctx, org.id, "bob@example.test");
    expect(
      await failure(
        call(
          authRouter.orgs.invite,
          {
            email: "x@example.test",
            orgId: org.id,
            role: "member",
            teamIds: [],
          },
          { context: bob.ctx }
        )
      )
    ).toBe("FORBIDDEN");
  });

  it("pages and searches members, with their teams", async () => {
    const t = await setup();
    const { ctx, org, platform } = await orgWithTree(t);
    await join(t, ctx, org.id, "bob@example.test", [platform.id]);
    await join(t, ctx, org.id, "carol@example.test");

    const first = await call(
      authRouter.orgs.members,
      { limit: 2, orgId: org.id },
      { context: ctx }
    );
    expect(first.items.map((each) => each.user.email)).toEqual([
      "admin@example.test",
      "bob@example.test",
    ]);
    expect(first.items[1]?.teamIds).toEqual([platform.id]);
    const second = await call(
      authRouter.orgs.members,
      { cursor: first.nextCursor ?? undefined, limit: 2, orgId: org.id },
      { context: ctx }
    );
    expect(second).toEqual({
      items: [expect.objectContaining({ role: "member" })],
      nextCursor: null,
    });
    const found = await call(
      authRouter.orgs.members,
      { limit: 10, orgId: org.id, query: "CAROL" },
      { context: ctx }
    );
    expect(found.items.map((each) => each.user.email)).toEqual([
      "carol@example.test",
    ]);
  });

  it("removing a member takes them out of its teams; the last owner can't leave", async () => {
    const t = await setup();
    const { admin, ctx, org, platform } = await orgWithTree(t);
    const bob = await join(t, ctx, org.id, "bob@example.test", [platform.id]);

    await call(
      authRouter.orgs.removeMember,
      { orgId: org.id, userId: bob.who.userId },
      { context: ctx }
    );
    expect(
      await call(
        authRouter.teams.members,
        { id: platform.id },
        { context: ctx }
      )
    ).toEqual([]);
    expect(
      await failure(
        call(authRouter.orgs.leave, { id: org.id }, { context: ctx })
      )
    ).toBe("CONFLICT:last_owner");
    expect(
      await failure(
        call(
          authRouter.orgs.updateMember,
          { orgId: org.id, role: "member", userId: admin.userId },
          { context: ctx }
        )
      )
    ).toBe("CONFLICT:last_owner");
  });

  it("refuses to delete or leave a personal org", async () => {
    const t = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    const ctx = await contextOf(t, ada);
    const { personalOrgId } = await call(authRouter.me.get, undefined, {
      context: ctx,
    });
    expect(
      await failure(
        call(authRouter.orgs.delete, { id: personalOrgId }, { context: ctx })
      )
    ).toBe("FORBIDDEN");
    expect(
      await failure(
        call(authRouter.orgs.leave, { id: personalOrgId }, { context: ctx })
      )
    ).toBe("FORBIDDEN");
  });

  it("deletes an org with its team tree", async () => {
    const t = await setup();
    const { ctx, org } = await orgWithTree(t);
    await call(authRouter.orgs.delete, { id: org.id }, { context: ctx });
    expect(
      await call(authRouter.orgs.list, undefined, { context: ctx })
    ).toEqual([]);
  });
});

describe("org policy", () => {
  it("clamps to the instance limits and keeps audit with the owner", async () => {
    const t = await setup({}, { policies: { auditPolicy: "forbidden" } });
    const { ctx, org } = await orgWithTree(t);
    const policy = {
      auditEnabled: true,
      chatContexts: ["personal", "team"] as const,
      personalKeyFallback: false,
      publishGate: "informational" as const,
      sampledScoring: false,
    };
    const view = await call(
      authRouter.orgs.updatePolicy,
      {
        id: org.id,
        policy: { ...policy, chatContexts: [...policy.chatContexts] },
      },
      { context: ctx }
    );
    expect(view.stored.auditEnabled).toBe(true);
    expect(view.effective.auditEnabled).toBe(false);
    expect(view.adjustments).toEqual([
      { field: "auditEnabled", reason: "forbidden_by_instance" },
    ]);

    // An admin who isn't the owner can't flip audit back off (or on).
    const bob = await join(t, ctx, org.id, "bob@example.test");
    await call(
      authRouter.orgs.updateMember,
      { orgId: org.id, role: "admin", userId: bob.who.userId },
      { context: ctx }
    );
    expect(
      await failure(
        call(
          authRouter.orgs.updatePolicy,
          {
            id: org.id,
            policy: {
              ...policy,
              auditEnabled: false,
              chatContexts: ["personal"],
            },
          },
          { context: bob.ctx }
        )
      )
    ).toBe("FORBIDDEN");
  });
});

describe("teams", () => {
  it("builds the tree; refuses cycles and deleting a parent", async () => {
    const t = await setup();
    const { ctx, eng, org, platform } = await orgWithTree(t);
    expect(
      await call(authRouter.teams.list, { orgId: org.id }, { context: ctx })
    ).toEqual([eng, platform]);
    expect(
      await failure(
        call(
          authRouter.teams.update,
          { id: eng.id, parentId: platform.id },
          { context: ctx }
        )
      )
    ).toBe("CONFLICT:team_cycle");
    expect(
      await failure(
        call(authRouter.teams.delete, { id: eng.id }, { context: ctx })
      )
    ).toBe("CONFLICT:not_empty");
    await call(authRouter.teams.delete, { id: platform.id }, { context: ctx });
    await call(authRouter.teams.delete, { id: eng.id }, { context: ctx });
    expect(
      await call(authRouter.teams.list, { orgId: org.id }, { context: ctx })
    ).toEqual([]);
  });

  it("lets a team admin manage below their team, not above or beside it", async () => {
    const t = await setup();
    const { ctx, eng, org, platform } = await orgWithTree(t);
    const lead = await join(t, ctx, org.id, "lead@example.test");
    await call(
      authRouter.teams.addMember,
      { role: "admin", teamId: platform.id, userId: lead.who.userId },
      { context: ctx }
    );

    const infra = await call(
      authRouter.teams.create,
      { name: "Infra", orgId: org.id, parentId: platform.id },
      { context: lead.ctx }
    );
    expect(infra.parentId).toBe(platform.id);
    expect(
      await failure(
        call(
          authRouter.teams.create,
          { name: "Sales", orgId: org.id, parentId: null },
          { context: lead.ctx }
        )
      )
    ).toBe("FORBIDDEN");
    expect(
      await failure(
        call(
          authRouter.teams.update,
          { id: eng.id, name: "Mine" },
          { context: lead.ctx }
        )
      )
    ).toBe("FORBIDDEN");
  });

  it("only takes org members", async () => {
    const t = await setup({ signup: "open" });
    const { ctx, eng } = await orgWithTree(t);
    const outsider = await signUp(t.auth, "outsider@example.test");
    expect(
      await failure(
        call(
          authRouter.teams.addMember,
          { role: "member", teamId: eng.id, userId: outsider.userId },
          { context: ctx }
        )
      )
    ).toBe("VALIDATION");
  });
});

describe("grants", () => {
  /** M1 §11 step 5: an agent A owns, shared with Eng; B sits in Platform. */
  const sharedAgent = async (t: TestAuth) => {
    const tree = await orgWithTree(t);
    const b = await join(t, tree.ctx, tree.org.id, "b@example.test", [
      tree.platform.id,
    ]);
    const [row] = await t.db
      .insert(agent)
      .values({
        createdBy: tree.admin.userId,
        name: "Reviewer",
        ownerId: tree.admin.userId,
        ownerType: "user",
      })
      .returning();
    if (!row) {
      throw new Error("no agent");
    }
    const ref = {
      resourceId: row.id as LibraryItemId,
      resourceType: "agent" as const,
    };
    return { ...tree, b, ref };
  };

  it("flows a team grant down the tree, and B can't edit until granted", async () => {
    const t = await setup();
    const { admin, b, ctx, eng, ref } = await sharedAgent(t);

    expect((await checkAccess(t.db, b.who.userId, ref, "use")).ok).toBe(false);
    const grant = await call(
      authRouter.grants.create,
      { ...ref, permission: "use", principal: { id: eng.id, type: "team" } },
      { context: ctx }
    );
    expect(grant).toMatchObject({
      grantedBy: admin.userId,
      permission: "use",
      principal: { id: eng.id, type: "team" },
    });
    expect((await checkAccess(t.db, b.who.userId, ref, "use")).ok).toBe(true);
    expect(await checkAccess(t.db, b.who.userId, ref, "edit")).toEqual({
      error: "forbidden",
      ok: false,
    });

    // B can see who has access, but can't share it on.
    expect(await call(authRouter.grants.list, ref, { context: b.ctx })).toEqual(
      [grant]
    );
    expect(
      await failure(
        call(
          authRouter.grants.create,
          {
            ...ref,
            permission: "edit",
            principal: { id: b.who.userId, type: "user" },
          },
          { context: b.ctx }
        )
      )
    ).toBe("FORBIDDEN");

    await call(
      authRouter.grants.create,
      {
        ...ref,
        permission: "edit",
        principal: { id: b.who.userId, type: "user" },
      },
      { context: ctx }
    );
    expect((await checkAccess(t.db, b.who.userId, ref, "edit")).ok).toBe(true);

    await call(
      authRouter.grants.update,
      { id: grant.id, permission: "view" },
      { context: ctx }
    );
    expect(
      await failure(
        call(
          authRouter.grants.update,
          { id: grant.id, permission: "editor" },
          { context: ctx }
        )
      )
    ).toBe("VALIDATION");
    await call(authRouter.grants.revoke, { id: grant.id }, { context: ctx });
    expect(
      (await call(authRouter.grants.list, ref, { context: ctx })).map(
        (each) => each.principal.type
      )
    ).toEqual(["user"]);
  });

  it("won't share into a team outside the sharer's orgs", async () => {
    const t = await setup({ signup: "open" });
    const { ref, ctx } = await sharedAgent(t);
    const other = await signUp(t.auth, "other@example.test");
    const otherCtx = await contextOf(t, other);
    const theirOrg = await call(
      authRouter.orgs.create,
      { name: "Theirs", slug: "theirs" },
      { context: otherCtx }
    );
    const theirTeam = await call(
      authRouter.teams.create,
      { name: "Secret", orgId: theirOrg.id, parentId: null },
      { context: otherCtx }
    );
    expect(
      await failure(
        call(
          authRouter.grants.create,
          {
            ...ref,
            permission: "use",
            principal: { id: theirTeam.id, type: "team" },
          },
          { context: ctx }
        )
      )
    ).toBe("VALIDATION");
  });

  it("lets an org admin read a chat only under the audit policy", async () => {
    const t = await setup();
    const { ctx, org } = await orgWithTree(t);
    const bob = await join(t, ctx, org.id, "bob@example.test");
    const [chat] = await t.db
      .insert(conversation)
      .values({
        contextId: org.id,
        contextType: "org",
        ownerId: bob.who.userId,
      })
      .returning();
    if (!chat) {
      throw new Error("no chat");
    }
    const ref = {
      resourceId: chat.id as ConversationId,
      resourceType: "conversation" as const,
    };
    const admin = (await contextOf(t, null)).config.policies;
    const adminId = ctx.session?.user.id as Parameters<typeof checkAccess>[1];

    expect((await checkAccess(t.db, adminId, ref, "viewer", admin)).ok).toBe(
      false
    );
    await call(
      authRouter.orgs.updatePolicy,
      {
        id: org.id,
        policy: {
          auditEnabled: true,
          chatContexts: ["personal", "team", "org"],
          personalKeyFallback: false,
          publishGate: "informational",
          sampledScoring: false,
        },
      },
      { context: ctx }
    );
    expect((await checkAccess(t.db, adminId, ref, "viewer", admin)).ok).toBe(
      true
    );
    expect((await checkAccess(t.db, adminId, ref, "editor", admin)).ok).toBe(
      false
    );
  });
});

describe("maintainers of a published item", () => {
  interface AgentRef {
    resourceId: LibraryItemId;
    resourceType: "agent";
  }

  /** An agent published to the org or its Eng team that Bob and Carol (both in Eng) maintain. */
  const published = async (t: TestAuth, library: "org" | "team") => {
    const tree = await orgWithTree(t);
    const bob = await join(t, tree.ctx, tree.org.id, "bob@example.test", [
      tree.eng.id,
    ]);
    const carol = await join(t, tree.ctx, tree.org.id, "carol@example.test", [
      tree.eng.id,
    ]);
    const [row] = await t.db
      .insert(agent)
      .values({
        createdBy: bob.who.userId,
        maintainers: [bob.who.userId, carol.who.userId],
        name: "Reviewer",
        ownerId: library === "org" ? tree.org.id : tree.eng.id,
        ownerType: library,
      })
      .returning();
    if (!row) {
      throw new Error("no agent");
    }
    const ref: AgentRef = {
      resourceId: row.id as LibraryItemId,
      resourceType: "agent",
    };
    // A grant and a link Carol made, for the others to try to revoke.
    const other = await signUp(t.auth, "other@example.test");
    const grant = await call(
      authRouter.grants.create,
      {
        ...ref,
        permission: "view",
        principal: { id: other.userId, type: "user" },
      },
      { context: carol.ctx }
    );
    const link = await call(authRouter.shareLinks.create, ref, {
      context: carol.ctx,
    });
    return { ...tree, bob, carol, earlier: { grant, link }, other, ref };
  };

  const outcome = (promise: Promise<unknown>): Promise<string> =>
    promise.then(
      () => "ok",
      (error: unknown) => failure(Promise.reject(error))
    );

  /** Every sharing action a maintainer takes, as the error each ends in (or `ok`). */
  const attempts = async (
    who: HandlerContext,
    { earlier, other, ref }: Awaited<ReturnType<typeof published>>
  ) => ({
    grant: await outcome(
      call(
        authRouter.grants.create,
        {
          ...ref,
          permission: "use",
          principal: { id: other.userId, type: "user" },
        },
        { context: who }
      )
    ),
    link: await outcome(
      call(authRouter.shareLinks.create, ref, { context: who })
    ),
    revokeGrant: await outcome(
      call(authRouter.grants.revoke, { id: earlier.grant.id }, { context: who })
    ),
    revokeLink: await outcome(
      call(
        authRouter.shareLinks.revoke,
        { id: earlier.link.id },
        { context: who }
      )
    ),
  });

  const refused = {
    grant: "FORBIDDEN",
    link: "FORBIDDEN",
    revokeGrant: "FORBIDDEN",
    revokeLink: "FORBIDDEN",
  };
  const allowed = {
    grant: "ok",
    link: "ok",
    revokeGrant: "ok",
    revokeLink: "ok",
  };

  it("stop sharing an org's item once they leave the org; current ones still can", async () => {
    const t = await setup(
      { signup: "open" },
      { features: { publicLinks: true } }
    );
    const item = await published(t, "org");
    await call(
      authRouter.orgs.removeMember,
      { orgId: item.org.id, userId: item.bob.who.userId },
      { context: item.ctx }
    );
    expect(await attempts(item.bob.ctx, item)).toEqual(refused);
    expect(await attempts(item.carol.ctx, item)).toEqual(allowed);
  });

  it("stop sharing a team's item once they leave the team, though still in the org", async () => {
    const t = await setup(
      { signup: "open" },
      { features: { publicLinks: true } }
    );
    const item = await published(t, "team");
    await call(
      authRouter.teams.removeMember,
      { teamId: item.eng.id, userId: item.bob.who.userId },
      { context: item.bob.ctx }
    );
    expect(await attempts(item.bob.ctx, item)).toEqual(refused);
    expect(await attempts(item.carol.ctx, item)).toEqual(allowed);
  });
});

describe("share links", () => {
  it("is off unless the instance enables public links", async () => {
    const t = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    const [row] = await t.db
      .insert(agent)
      .values({
        createdBy: ada.userId,
        name: "A",
        ownerId: ada.userId,
        ownerType: "user",
      })
      .returning();
    expect(
      await failure(
        call(
          authRouter.shareLinks.create,
          { resourceId: row?.id as LibraryItemId, resourceType: "agent" },
          { context: await contextOf(t, ada) }
        )
      )
    ).toBe("FEATURE_DISABLED");
  });

  it("creates, resolves anonymously and revokes", async () => {
    const t = await setup({}, { features: { publicLinks: true } });
    const ada = await signUp(t.auth, "ada@example.test");
    const adaCtx = await contextOf(t, ada);
    const { personalOrgId } = await call(authRouter.me.get, undefined, {
      context: adaCtx,
    });
    const [chat] = await t.db
      .insert(conversation)
      .values({
        contextId: personalOrgId,
        contextType: "personal",
        ownerId: ada.userId,
      })
      .returning();
    const ref = {
      resourceId: chat?.id as ConversationId,
      resourceType: "conversation" as const,
    };
    const shared: SharedResource = {
      branch: {
        conversationId: ref.resourceId,
        leafId: null,
        messages: [],
        siblings: [],
      },
      resourceType: "conversation",
      title: null,
    };
    const loaded: unknown[] = [];
    const anonymous = await contextOf(t, null, {
      loadSharedResource: (resource) => {
        loaded.push(resource);
        return Promise.resolve(shared);
      },
    });

    const link = await call(authRouter.shareLinks.create, ref, {
      context: adaCtx,
    });
    expect(link.url).toBe(`https://chat.example.test/share/${link.token}`);
    expect(link.token.length).toBeGreaterThanOrEqual(43);
    expect(
      await call(
        authRouter.shareLinks.resolve,
        { token: link.token },
        { context: anonymous }
      )
    ).toEqual(shared);
    expect(loaded).toEqual([ref]);

    await call(
      authRouter.shareLinks.revoke,
      { id: link.id },
      { context: adaCtx }
    );
    expect(
      await failure(
        call(
          authRouter.shareLinks.resolve,
          { token: link.token },
          { context: anonymous }
        )
      )
    ).toBe("NOT_FOUND");
    expect(
      await call(authRouter.shareLinks.list, ref, { context: adaCtx })
    ).toEqual([
      expect.objectContaining({ id: link.id, revokedAt: expect.any(String) }),
    ]);
  });
});
