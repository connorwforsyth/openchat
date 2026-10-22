import { textStream } from "@workspace/ai/testing/mock-models";
import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { SpaceRef } from "@workspace/contract/schemas/spaces";
import {
  decideAllowanceGrant,
  requestAllowanceGrant,
  setSpaceAllowance,
} from "@workspace/db/queries/spaces";
import { recordTransaction } from "@workspace/db/queries/usage";
import { member } from "@workspace/db/schema/auth";
import { teamMember } from "@workspace/db/schema/tenancy";
import { seedOrg, seedTeam, seedUser } from "@workspace/db/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../testing/harness";

// A space's token allowance (192) is checked before a run exists, like a
// money budget (D24): a member needs an approved grant with tokens left,
// owners draw on the pool, and the nearest pool among the chat's space and
// the spaces above it that the caller is a member of is the one that counts.

const reply = () =>
  new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve(
        textStream("Done", {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: 10,
            total: 10,
          },
          outputTokens: { reasoning: undefined, text: 5, total: 5 },
        })
      ),
  });

let h: Harness;
let orgId: OrgId;
let team: SpaceRef;
let memberId: UserId;

beforeEach(async () => {
  h = await createHarness({
    models: { "test:model": reply() },
    realTurns: true,
  });
  orgId = (await seedOrg(h.db, h.ownerId)).id;
  team = { id: (await seedTeam(h.db, orgId)).id, type: "team" };
  memberId = (await seedUser(h.db)).id;
  await seedOrg(h.db, memberId, { isPersonal: true });
  await h.db
    .insert(member)
    .values({ organizationId: orgId, role: "member", userId: memberId });
  await h.db
    .insert(teamMember)
    .values({ role: "member", teamId: team.id, userId: memberId });
});

afterEach(() => h.close());

const send = async (as: UserId, context: SpaceRef) => {
  const chat = (await (
    await h.request("/api/conversations", {
      as,
      json: { context },
      method: "POST",
    })
  ).json()) as Conversation;
  const response = await h.request("/api/runs", {
    as,
    json: {
      conversationId: chat.id,
      input: {
        parentId: null,
        parts: [{ text: "hello", type: "text" }],
        type: "message",
      },
      target: { model: "test:model", type: "model" },
    },
    method: "POST",
  });
  await h.services.executor.idle();
  return response;
};

const pool = (space: SpaceRef, monthlyTokens: number | null) =>
  setSpaceAllowance(h.db, {
    monthlyTokens,
    orgId,
    space,
    userId: h.ownerId,
  });

const grant = async (
  space: SpaceRef,
  userId: UserId,
  monthlyTokens: number
) => {
  const row = await requestAllowanceGrant(
    h.db,
    { monthlyTokens, note: "", orgId, space, userId },
    new Date()
  );
  await decideAllowanceGrant(
    h.db,
    {
      decidedBy: h.ownerId,
      grantId: row.id,
      space,
      status: "approved",
    },
    new Date()
  );
};

const use = (userId: UserId, context: SpaceRef, tokens: number) =>
  recordTransaction(h.db, {
    context,
    costMicros: 0,
    kind: "chat",
    model: "test:model",
    orgId,
    paidBy: { type: "instance" },
    usage: { inputTokens: tokens, outputTokens: 0 },
    userId,
  });

const outcome = async (response: Response) => ({
  body: await response.json(),
  status: response.status,
});

const spentIn = (space: SpaceRef) => ({
  body: { code: "ALLOWANCE_SPENT", data: { space } },
  status: 402,
});

describe("token allowance before a run", () => {
  it("doesn't limit a space with no pool", async () => {
    expect((await send(memberId, team)).status).toBe(202);
  });

  it("refuses a member with no approved grant once the space has a pool", async () => {
    await pool(team, 1000);
    expect(await outcome(await send(memberId, team))).toMatchObject(
      spentIn(team)
    );
  });

  it("lets a granted member run until their grant is used", async () => {
    await pool(team, 1000);
    await grant(team, memberId, 100);
    expect((await send(memberId, team)).status).toBe(202);
    await use(memberId, team, 100);
    expect(await outcome(await send(memberId, team))).toMatchObject(
      spentIn(team)
    );
  });

  it("stops everyone, owners too, once the pool itself is used", async () => {
    const org: SpaceRef = { id: orgId, type: "org" };
    await pool(org, 100);
    await grant(org, memberId, 1000);
    expect((await send(h.ownerId, org)).status).toBe(202);
    await use(memberId, team, 100);
    expect(await outcome(await send(memberId, team))).toMatchObject(
      spentIn(org)
    );
    expect(await outcome(await send(h.ownerId, org))).toMatchObject(
      spentIn(org)
    );
  });

  it("applies a root space's pool to chats in the spaces below it", async () => {
    const org: SpaceRef = { id: orgId, type: "org" };
    await pool(org, 1000);
    expect(await outcome(await send(memberId, team))).toMatchObject(
      spentIn(org)
    );
    await grant(org, memberId, 100);
    expect((await send(memberId, team)).status).toBe(202);
  });

  describe("in a sub-space whose parent the caller isn't in", () => {
    let child: SpaceRef;
    let adaId: UserId;

    beforeEach(async () => {
      child = {
        id: (await seedTeam(h.db, orgId, team.id as TeamId)).id,
        type: "team",
      };
      adaId = (await seedUser(h.db)).id;
      await seedOrg(h.db, adaId, { isPersonal: true });
      await h.db
        .insert(member)
        .values({ organizationId: orgId, role: "member", userId: adaId });
      await h.db
        .insert(teamMember)
        .values({ role: "member", teamId: child.id, userId: adaId });
      await pool(team, 1000);
    });

    it("ignores the parent's pool when the sub-space has none", async () => {
      expect((await send(adaId, child)).status).toBe(202);
    });

    it("limits by the sub-space's own pool and grant", async () => {
      await pool(child, 1000);
      expect(await outcome(await send(adaId, child))).toMatchObject(
        spentIn(child)
      );
      await grant(child, adaId, 100);
      expect((await send(adaId, child)).status).toBe(202);
    });
  });

  it("counts only the nearest pool the caller is a member of", async () => {
    const org: SpaceRef = { id: orgId, type: "org" };
    await pool(org, 1000);
    await pool(team, 1000);
    await grant(team, memberId, 100);
    expect((await send(memberId, team)).status).toBe(202);
  });
});
