import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { resourceGrant } from "../schema/access";
import { teamMember } from "../schema/tenancy";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "../testing";
import {
  createShareLink,
  deleteGrant,
  deleteGrantsForResource,
  findShareLinkByToken,
  isPermissionFor,
  listGrantsForPrincipals,
  listGrantsForResource,
  listShareLinks,
  revokeShareLink,
  updateGrantPermission,
  upsertGrant,
} from "./grants";
import { loadPrincipals, teamAncestors, teamSubtree } from "./teams";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const agentRef = () => ({
  resourceId: newId("libraryItem"),
  resourceType: "agent" as const,
});

describe("principals and the team tree", () => {
  test("a member acts as themselves, their orgs, their teams and those teams' ancestors", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);
    const engineering = await seedTeam(db, org.id);
    const platform = await seedTeam(db, org.id, engineering.id);
    const infra = await seedTeam(db, org.id, platform.id);
    const design = await seedTeam(db, org.id);
    await db
      .insert(teamMember)
      .values({ teamId: platform.id, userId: owner.id });

    const principals = await loadPrincipals(db, owner.id);
    expect(principals).toContainEqual({ id: owner.id, type: "user" });
    expect(principals).toContainEqual({ id: org.id, type: "org" });
    expect(principals).toContainEqual({ id: platform.id, type: "team" });
    expect(principals).toContainEqual({ id: engineering.id, type: "team" });
    expect(principals).not.toContainEqual({ id: infra.id, type: "team" });
    expect(principals).not.toContainEqual({ id: design.id, type: "team" });

    expect(new Set(await teamSubtree(db, engineering.id))).toEqual(
      new Set([engineering.id, platform.id, infra.id])
    );
    expect(new Set(await teamAncestors(db, [infra.id, design.id]))).toEqual(
      new Set([infra.id, platform.id, engineering.id, design.id])
    );
    expect(await teamAncestors(db, [])).toEqual([]);
  });
});

describe("grants", () => {
  test("re-granting replaces the level; the level must suit the resource", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const friend = await seedUser(db);
    const resource = agentRef();
    const principal = { id: friend.id, type: "user" } as const;
    const first = expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "use",
        principal,
        resource,
      })
    );
    const second = expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "edit",
        principal,
        resource,
      })
    );
    expect(second.id).toBe(first.id);
    expect(second.permission).toBe("edit");
    expect(await listGrantsForResource(db, resource)).toHaveLength(1);

    expect(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "editor",
        principal,
        resource,
      })
    ).toMatchObject({
      error: { reason: "invalid_permission", type: "conflict" },
    });
    expect(await updateGrantPermission(db, first.id, "viewer")).toMatchObject({
      error: { reason: "invalid_permission" },
    });
    expect(
      expectOk(await updateGrantPermission(db, first.id, "view")).permission
    ).toBe("view");
    expect(
      await updateGrantPermission(db, newId("grant"), "view")
    ).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("the database refuses a mismatched level even without the check", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    await expect(
      db.insert(resourceGrant).values({
        grantedBy: owner.id,
        permission: "use",
        principalId: owner.id,
        principalType: "user",
        resourceId: newId("conversation"),
        resourceType: "conversation",
      })
    ).rejects.toThrow();
  });

  test("lists what a principal set holds, and cleans up by resource", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id);
    const team = await seedTeam(db, org.id);
    const a = agentRef();
    const b = {
      resourceId: newId("libraryItem"),
      resourceType: "prompt" as const,
    };
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "use",
        principal: { id: team.id, type: "team" },
        resource: a,
      })
    );
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "view",
        principal: { id: org.id, type: "org" },
        resource: b,
      })
    );
    const principals = [
      { id: team.id, type: "team" },
      { id: org.id, type: "org" },
    ] as const;
    expect(await listGrantsForPrincipals(db, principals)).toHaveLength(2);
    expect(
      await listGrantsForPrincipals(db, principals, { resourceType: "prompt" })
    ).toMatchObject([{ permission: "view", resourceId: b.resourceId }]);
    expect(
      await listGrantsForPrincipals(db, principals, {
        resourceIds: [a.resourceId],
      })
    ).toHaveLength(1);
    expect(await listGrantsForPrincipals(db, [])).toEqual([]);

    const [grant] = await listGrantsForResource(db, a);
    expect(grant && expectOk(await deleteGrant(db, grant.id)).id).toBe(
      grant?.id
    );
    expect(await deleteGrant(db, newId("grant"))).toMatchObject({
      error: { type: "not_found" },
    });

    await deleteGrantsForResource(db, b);
    expect(await listGrantsForResource(db, b)).toEqual([]);
  });

  test("isPermissionFor", () => {
    expect(isPermissionFor("conversation", "editor")).toBe(true);
    expect(isPermissionFor("conversation", "edit")).toBe(false);
    expect(isPermissionFor("skill", "use")).toBe(true);
    expect(isPermissionFor("skill", "viewer")).toBe(false);
  });
});

describe("share links", () => {
  test("only live links resolve", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const resource = agentRef();
    const now = new Date("2026-09-27T12:00:00Z");
    const live = await createShareLink(db, {
      createdBy: owner.id,
      resource,
      token: `live-${newId("x")}`,
    });
    const expiring = await createShareLink(db, {
      createdBy: owner.id,
      expiresAt: new Date("2026-09-27T13:00:00Z"),
      resource,
      token: `expiring-${newId("x")}`,
    });

    expect(expectOk(await findShareLinkByToken(db, live.token, now)).id).toBe(
      live.id
    );
    expect(
      expectOk(await findShareLinkByToken(db, expiring.token, now)).id
    ).toBe(expiring.id);
    expect(
      await findShareLinkByToken(
        db,
        expiring.token,
        new Date("2026-09-27T14:00:00Z")
      )
    ).toMatchObject({ error: { id: "token", type: "not_found" } });

    const revoked = expectOk(await revokeShareLink(db, live.id, now));
    expect(revoked.revokedAt?.toISOString()).toBe(now.toISOString());
    expect(await findShareLinkByToken(db, live.token, now)).toMatchObject({
      error: { type: "not_found" },
    });
    expect(await listShareLinks(db, resource)).toHaveLength(2);
    expect(await revokeShareLink(db, newId("shareLink"))).toMatchObject({
      error: { type: "not_found" },
    });
  });
});
