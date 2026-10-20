import type { OrgId, UserId } from "@workspace/contract/schemas/common";
import type { SpaceRef } from "@workspace/contract/schemas/spaces";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import { resourceGrant } from "../schema/access";
import { user } from "../schema/auth";
import { conversation } from "../schema/chat";
import { agent, skill } from "../schema/library";
import { spaceAllowance, spaceAllowanceGrant } from "../schema/spaces";
import { providerKey, transaction } from "../schema/usage";

// Spaces (ticket 187): what's shared to a space, its token allowance and the
// usage against its keys. A space is an org or a team, named like a grant
// principal (`{ type, id }`), so shared content is plain `resource_grant`
// rows to the space.

const CONTENT_TYPES = ["conversation", "agent", "skill"] as const;
export type SpaceContentType = (typeof CONTENT_TYPES)[number];

const heldBySpaces = (spaces: readonly SpaceRef[]): SQL =>
  or(
    ...spaces.map((space) =>
      and(
        eq(resourceGrant.principalType, space.type),
        eq(resourceGrant.principalId, space.id)
      )
    )
  ) ?? sql`false`;

export interface SpaceContentRow {
  readonly grantedAt: Date;
  readonly grantedBy: typeof user.$inferSelect;
  readonly resourceId: string;
  readonly resourceType: SpaceContentType;
  readonly space: SpaceRef;
  readonly title: string;
}

/** Chats, agents and skills shared to any of `spaces`, newest first. */
export const listSpaceContent = async (
  db: Db,
  spaces: readonly SpaceRef[]
): Promise<SpaceContentRow[]> => {
  if (spaces.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      agentName: agent.name,
      chatTitle: conversation.title,
      grant: resourceGrant,
      grantedBy: user,
      skillName: skill.name,
    })
    .from(resourceGrant)
    .innerJoin(user, eq(user.id, resourceGrant.grantedBy))
    .leftJoin(
      conversation,
      and(
        eq(resourceGrant.resourceType, "conversation"),
        eq(conversation.id, resourceGrant.resourceId)
      )
    )
    .leftJoin(
      agent,
      and(
        eq(resourceGrant.resourceType, "agent"),
        eq(agent.id, resourceGrant.resourceId)
      )
    )
    .leftJoin(
      skill,
      and(
        eq(resourceGrant.resourceType, "skill"),
        eq(skill.id, resourceGrant.resourceId)
      )
    )
    .where(
      and(
        heldBySpaces(spaces),
        inArray(resourceGrant.resourceType, [...CONTENT_TYPES])
      )
    )
    .orderBy(desc(resourceGrant.createdAt));
  return rows.flatMap((row) => {
    const title = row.chatTitle ?? row.agentName ?? row.skillName;
    // A grant can outlive a deleted resource only briefly; skip it.
    if (title === null && row.grant.resourceType !== "conversation") {
      return [];
    }
    return [
      {
        grantedAt: row.grant.createdAt,
        grantedBy: row.grantedBy,
        resourceId: row.grant.resourceId,
        resourceType: row.grant.resourceType as SpaceContentType,
        space: {
          id: row.grant.principalId,
          type: row.grant.principalType,
        } as SpaceRef,
        title: title ?? "",
      },
    ];
  });
};

/** Start of the UTC month `now` falls in, and of the next. */
export const monthOf = (now: Date): { from: Date; to: Date } => {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
};

const tokens = sql<number>`coalesce(sum(${transaction.inputTokens} + ${transaction.outputTokens}), 0)::bigint`;

/**
 * Tokens used per user this month in chats whose context is one of
 * `contexts` (a space and the spaces below it: usage rolls up, D17).
 */
export const tokensByUser = async (
  db: Db,
  contexts: readonly SpaceRef[],
  now: Date
): Promise<Map<UserId, number>> => {
  if (contexts.length === 0) {
    return new Map();
  }
  const { from, to } = monthOf(now);
  const rows = await db
    .select({ tokens, userId: transaction.userId })
    .from(transaction)
    .where(
      and(
        or(
          ...contexts.map((space) =>
            and(
              eq(transaction.contextType, space.type),
              eq(transaction.contextId, space.id)
            )
          )
        ),
        gte(transaction.createdAt, from),
        lt(transaction.createdAt, to)
      )
    )
    .groupBy(transaction.userId);
  return new Map(rows.map((row) => [row.userId, Number(row.tokens)]));
};

export type SpaceAllowanceRow = typeof spaceAllowance.$inferSelect;
export type AllowanceGrantRow = typeof spaceAllowanceGrant.$inferSelect;

export const getSpaceAllowance = async (
  db: Db,
  space: SpaceRef
): Promise<SpaceAllowanceRow | null> => {
  const [row] = await db
    .select()
    .from(spaceAllowance)
    .where(
      and(
        eq(spaceAllowance.spaceType, space.type),
        eq(spaceAllowance.spaceId, space.id)
      )
    );
  return row ?? null;
};

export const setSpaceAllowance = async (
  db: Db,
  input: {
    readonly monthlyTokens: number | null;
    readonly orgId: OrgId;
    readonly space: SpaceRef;
    readonly userId: UserId;
  }
): Promise<void> => {
  if (input.monthlyTokens === null) {
    await db
      .delete(spaceAllowance)
      .where(
        and(
          eq(spaceAllowance.spaceType, input.space.type),
          eq(spaceAllowance.spaceId, input.space.id)
        )
      );
    return;
  }
  await db
    .insert(spaceAllowance)
    .values({
      monthlyTokens: input.monthlyTokens,
      orgId: input.orgId,
      spaceId: input.space.id,
      spaceType: input.space.type,
      updatedBy: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        monthlyTokens: input.monthlyTokens,
        updatedAt: new Date(),
        updatedBy: input.userId,
      },
      target: [spaceAllowance.spaceType, spaceAllowance.spaceId],
    });
};

export const listAllowanceGrants = (db: Db, space: SpaceRef) =>
  db
    .select({ grant: spaceAllowanceGrant, user })
    .from(spaceAllowanceGrant)
    .innerJoin(user, eq(user.id, spaceAllowanceGrant.userId))
    .where(
      and(
        eq(spaceAllowanceGrant.spaceType, space.type),
        eq(spaceAllowanceGrant.spaceId, space.id)
      )
    )
    .orderBy(desc(spaceAllowanceGrant.requestedAt));

/** A member's request; replaces their earlier one, back to pending. */
export const requestAllowanceGrant = async (
  db: Db,
  input: {
    readonly monthlyTokens: number;
    readonly note: string;
    readonly orgId: OrgId;
    readonly space: SpaceRef;
    readonly userId: UserId;
  },
  now: Date
): Promise<AllowanceGrantRow> => {
  const [row] = await db
    .insert(spaceAllowanceGrant)
    .values({
      monthlyTokens: input.monthlyTokens,
      note: input.note,
      orgId: input.orgId,
      requestedAt: now,
      spaceId: input.space.id,
      spaceType: input.space.type,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        decidedAt: null,
        decidedBy: null,
        monthlyTokens: input.monthlyTokens,
        note: input.note,
        requestedAt: now,
        status: "pending",
      },
      target: [
        spaceAllowanceGrant.spaceType,
        spaceAllowanceGrant.spaceId,
        spaceAllowanceGrant.userId,
      ],
    })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export const decideAllowanceGrant = async (
  db: Db,
  input: {
    readonly decidedBy: UserId;
    readonly grantId: string;
    readonly monthlyTokens?: number;
    readonly space: SpaceRef;
    readonly status: "approved" | "denied";
  },
  now: Date
): Promise<AllowanceGrantRow | null> => {
  const [row] = await db
    .update(spaceAllowanceGrant)
    .set({
      decidedAt: now,
      decidedBy: input.decidedBy,
      status: input.status,
      ...(input.monthlyTokens ? { monthlyTokens: input.monthlyTokens } : {}),
    })
    .where(
      and(
        eq(spaceAllowanceGrant.id, input.grantId),
        eq(spaceAllowanceGrant.spaceType, input.space.type),
        eq(spaceAllowanceGrant.spaceId, input.space.id)
      )
    )
    .returning();
  return row ?? null;
};

export interface KeyUsageRow {
  readonly costMicros: number;
  readonly key:
    | (typeof providerKey.$inferSelect & {
        readonly creator: typeof user.$inferSelect | null;
      })
    | null;
  readonly tokens: number;
  readonly transactions: number;
}

/**
 * This month's usage against each key stored in `space` (193), plus one row
 * with `key: null` for usage the space paid for before keys were attributed.
 * Keys with no use this month are included at zero.
 */
export const keyUsageForSpace = async (
  db: Db,
  space: SpaceRef,
  now: Date
): Promise<KeyUsageRow[]> => {
  const { from, to } = monthOf(now);
  const keys = await db
    .select({ creator: user, key: providerKey })
    .from(providerKey)
    .leftJoin(user, eq(user.id, providerKey.createdBy))
    .where(
      and(
        eq(providerKey.scopeType, space.type),
        eq(providerKey.scopeId, space.id)
      )
    )
    .orderBy(desc(providerKey.createdAt));
  const sums = await db
    .select({
      cost: sql<number>`coalesce(sum(${transaction.costMicros}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
      keyId: transaction.providerKeyId,
      tokens,
    })
    .from(transaction)
    .where(
      and(
        eq(transaction.paidByType, space.type),
        eq(transaction.paidById, space.id),
        gte(transaction.createdAt, from),
        lt(transaction.createdAt, to)
      )
    )
    .groupBy(transaction.providerKeyId);
  const byKey = new Map(sums.map((row) => [row.keyId ?? "", row]));
  const rows: KeyUsageRow[] = keys.map(({ creator, key }) => {
    const sum = byKey.get(key.id);
    return {
      costMicros: Number(sum?.cost ?? 0),
      key: { ...key, creator },
      tokens: Number(sum?.tokens ?? 0),
      transactions: sum?.count ?? 0,
    };
  });
  const unattributed = byKey.get("");
  return unattributed
    ? [
        ...rows,
        {
          costMicros: Number(unattributed.cost),
          key: null,
          tokens: Number(unattributed.tokens),
          transactions: unattributed.count,
        },
      ]
    : rows;
};
