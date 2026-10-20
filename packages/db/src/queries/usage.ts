import type {
  BudgetId,
  OrgId,
  ProviderKeyId,
  RunId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  ModelRef,
  ProviderId,
  TokenUsage,
} from "@workspace/contract/schemas/models";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type {
  Budget,
  budgetPeriodSchema,
  Transaction,
  usageKindSchema,
  usageSummaryInputSchema,
} from "@workspace/contract/schemas/usage";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
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
import type { z } from "zod";
import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import { user } from "../schema/auth";
import { conversation, run } from "../schema/chat";
import type { PrincipalId } from "../schema/columns";
import { budget } from "../schema/tenancy";
import { balance, providerKey, transaction } from "../schema/usage";
import type { StoredContext } from "./conversations";
import {
  decodeCursor,
  type InvalidCursorError,
  type Page,
  toPage,
} from "./page";
import { teamAncestors } from "./teams";

// Usage and budgets (D17, D24). Each model call is a transaction recorded
// against the user and the chat context; `balance` keeps running spend per
// principal and period so the budget check before a run is a few indexed
// reads. Team spend rolls up to parent teams and the org.

export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;
export type TransactionRow = typeof transaction.$inferSelect;
export type BudgetRow = typeof budget.$inferSelect;

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["day", "week", "month"];

/** Start of the period containing `now`, in UTC. Weeks start on Monday (ISO 8601). */
export const periodStart = (period: BudgetPeriod, now: Date): Date => {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  switch (period) {
    case "day":
      return day;
    case "week":
      return new Date(
        day.getTime() - ((day.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000
      );
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    default:
      return period satisfies never;
  }
};

export interface NewTransaction {
  /** The chat context as stored; `orgId` is its org (the personal org for Personal). */
  readonly context: StoredContext;
  readonly costMicros: number;
  readonly kind: z.infer<typeof usageKindSchema>;
  readonly model: ModelRef;
  readonly orgId: OrgId;
  /** Whose key paid; `instance` for keys from app.config.yaml. */
  readonly paidBy:
    | { readonly type: "instance" }
    | { readonly id: PrincipalId; readonly type: "org" | "team" | "user" };
  readonly runId?: RunId | null;
  readonly usage: TokenUsage;
  readonly userId: UserId;
}

/** The principals whose balances a transaction adds to: the user, the context's team chain, the org. */
const chargedPrincipals = async (
  db: Db,
  input: NewTransaction
): Promise<Principal[]> => {
  const teams =
    input.context.type === "team"
      ? await teamAncestors(db, [input.context.id as TeamId])
      : [];
  return [
    { id: input.userId, type: "user" },
    ...teams.map((id): Principal => ({ id, type: "team" })),
    { id: input.orgId, type: "org" },
  ];
};

/**
 * The stored key that paid (ticket 193): the newest key of the paying scope
 * for the model's provider, which is the one key resolution picks. Resolved
 * here so the key ports needn't carry key ids.
 */
const payingKeyId = async (
  db: Db,
  input: NewTransaction
): Promise<ProviderKeyId | null> => {
  if (input.paidBy.type === "instance") {
    return null;
  }
  const provider = input.model.slice(0, input.model.indexOf(":"));
  const [row] = await db
    .select({ id: providerKey.id })
    .from(providerKey)
    .where(
      and(
        eq(providerKey.scopeType, input.paidBy.type),
        eq(providerKey.scopeId, input.paidBy.id),
        eq(providerKey.provider, provider as ProviderId)
      )
    )
    .orderBy(desc(providerKey.createdAt))
    .limit(1);
  return row?.id ?? null;
};

/** Records a model call and adds its cost to every balance it counts toward. */
export const recordTransaction = (
  db: Db,
  input: NewTransaction,
  now: Date = new Date()
): Promise<TransactionRow> =>
  db.transaction(async (tx) => {
    const providerKeyId = await payingKeyId(tx, input);
    const [row] = await tx
      .insert(transaction)
      .values({
        cachedInputTokens: input.usage.cachedInputTokens ?? null,
        contextId: input.context.id,
        contextType: input.context.type,
        costMicros: input.costMicros,
        createdAt: now,
        inputTokens: input.usage.inputTokens,
        kind: input.kind,
        model: input.model,
        orgId: input.orgId,
        outputTokens: input.usage.outputTokens,
        paidById: input.paidBy.type === "instance" ? null : input.paidBy.id,
        paidByType: input.paidBy.type,
        providerKeyId,
        reasoningTokens: input.usage.reasoningTokens ?? null,
        runId: input.runId ?? null,
        userId: input.userId,
      })
      .returning();
    if (!row) {
      throw new Error("insert returned no row");
    }
    const principals = await chargedPrincipals(tx, input);
    await tx
      .insert(balance)
      .values(
        principals.flatMap((principal) =>
          BUDGET_PERIODS.map((period) => ({
            orgId: input.orgId,
            period,
            periodStart: periodStart(period, now),
            principalId: principal.id,
            principalType: principal.type,
            spentMicros: input.costMicros,
          }))
        )
      )
      .onConflictDoUpdate({
        set: {
          spentMicros: sql`${balance.spentMicros} + excluded.spent_micros`,
          updatedAt: now,
        },
        target: [
          balance.orgId,
          balance.principalType,
          balance.principalId,
          balance.period,
          balance.periodStart,
        ],
      });
    return row;
  });

/** Spend in the current period (zero when nothing was recorded). */
export const getSpend = async (
  db: Db,
  orgId: OrgId,
  principal: Principal,
  period: BudgetPeriod,
  now: Date = new Date()
): Promise<number> => {
  const [row] = await db
    .select({ spentMicros: balance.spentMicros })
    .from(balance)
    .where(
      and(
        eq(balance.orgId, orgId),
        eq(balance.principalType, principal.type),
        eq(balance.principalId, principal.id),
        eq(balance.period, period),
        eq(balance.periodStart, periodStart(period, now))
      )
    );
  return row?.spentMicros ?? 0;
};

export interface BudgetInput {
  readonly hard: boolean;
  readonly limitMicros: number;
  readonly orgId: OrgId;
  readonly period: BudgetPeriod;
  readonly principal: Principal;
}

/** One budget per principal and period: setting it again replaces it. */
export const setBudget = async (
  db: Db,
  input: BudgetInput
): Promise<BudgetRow> => {
  const [row] = await db
    .insert(budget)
    .values({
      hard: input.hard,
      limitMicros: input.limitMicros,
      orgId: input.orgId,
      period: input.period,
      principalId: input.principal.id,
      principalType: input.principal.type,
    })
    .onConflictDoUpdate({
      set: { hard: input.hard, limitMicros: input.limitMicros },
      target: [
        budget.orgId,
        budget.principalType,
        budget.principalId,
        budget.period,
      ],
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return row;
};

export interface BudgetStatus extends BudgetRow {
  readonly resetsAt: Date;
  readonly usedMicros: number;
}

const nextPeriodStart = (period: BudgetPeriod, now: Date): Date => {
  const start = periodStart(period, now);
  switch (period) {
    case "day":
      return new Date(start.getTime() + 24 * 60 * 60 * 1000);
    case "week":
      return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
      );
    default:
      return period satisfies never;
  }
};

/**
 * Budgets that apply to `principals` in `orgId`, with this period's spend.
 * Pass one principal for the admin view, or everyone a run charges (the
 * user, the context's team chain, the org) for the pre-run check.
 */
export const budgetStatuses = async (
  db: Db,
  orgId: OrgId,
  principals: readonly Principal[],
  now: Date = new Date()
): Promise<BudgetStatus[]> => {
  if (principals.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(budget)
    .where(
      and(
        eq(budget.orgId, orgId),
        or(
          ...principals.map((principal) =>
            and(
              eq(budget.principalType, principal.type),
              eq(budget.principalId, principal.id)
            )
          )
        )
      )
    );
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      resetsAt: nextPeriodStart(row.period, now),
      usedMicros: await getSpend(
        db,
        orgId,
        { id: row.principalId, type: row.principalType } as Principal,
        row.period,
        now
      ),
    }))
  );
};

/** The budgets that are spent: hard ones block a run, soft ones only warn. */
export const exceededBudgets = (
  statuses: readonly BudgetStatus[]
): BudgetStatus[] =>
  statuses.filter((status) => status.usedMicros >= status.limitMicros);

export const listBudgets = (db: Db, orgId: OrgId): Promise<BudgetRow[]> =>
  db.select().from(budget).where(eq(budget.orgId, orgId));

/** A user's transactions, newest first. */
export const listTransactions = async (
  db: Db,
  userId: UserId,
  { cursor, limit }: { readonly cursor?: string; readonly limit: number }
): AsyncResult<Page<TransactionRow>, InvalidCursorError> => {
  const decoded = cursor ? decodeCursor(cursor) : undefined;
  if (decoded && !decoded.ok) {
    return err(decoded.error);
  }
  const rows = await db
    .select()
    .from(transaction)
    .where(
      and(
        eq(transaction.userId, userId),
        decoded?.ok
          ? lt(transaction.id, decoded.value.id as TransactionRow["id"])
          : undefined
      )
    )
    .orderBy(desc(transaction.id))
    .limit(limit + 1);
  return ok(
    toPage(rows, limit, (row) => ({
      id: row.id,
      key: row.createdAt.toISOString(),
    }))
  );
};

// --- Added for the usage API (ticket 038) ---

/**
 * Whose usage to read. A user's is everything they spent, in any context; a
 * team's is its chats and its sub-teams' (pass the subtree); an org's is
 * everything recorded in it.
 */
export type UsageFilter =
  | { readonly type: "user"; readonly userId: UserId }
  | { readonly teamIds: readonly TeamId[]; readonly type: "team" }
  | { readonly orgId: OrgId; readonly type: "org" };

const filterWhere = (filter: UsageFilter): SQL | undefined => {
  switch (filter.type) {
    case "user":
      return eq(transaction.userId, filter.userId);
    case "team":
      return filter.teamIds.length === 0
        ? sql`false`
        : and(
            eq(transaction.contextType, "team"),
            inArray(transaction.contextId, [...filter.teamIds])
          );
    case "org":
      return eq(transaction.orgId, filter.orgId);
    default:
      return filter satisfies never;
  }
};

export type UsageGroupBy = z.infer<typeof usageSummaryInputSchema>["groupBy"];

/** Usage in a space and the spaces below it: an org's everything, a team's subtree. */
export type SpaceScope = Exclude<UsageFilter, { readonly type: "user" }>;

export interface UsageQuery {
  readonly from: Date;
  readonly groupBy: UsageGroupBy;
  /** Only usage paid with this stored key. */
  readonly keyId?: ProviderKeyId;
  readonly space?: SpaceScope;
  readonly to: Date;
}

export interface UsageSummaryRow {
  readonly costMicros: number;
  readonly key: string;
  readonly label?: string;
  readonly usage: TokenUsage;
}

/**
 * How each grouping reads its key and, where the key is an id, a name for
 * it. `""` is the group of rows with no chat, or paid by instance keys.
 */
const GROUPS: Record<
  UsageGroupBy,
  { readonly key: SQL<string>; readonly label?: SQL<string | null> }
> = {
  conversation: {
    key: sql<string>`coalesce(${run.conversationId}::text, '')`,
    label: sql<string | null>`max(${conversation.title})`,
  },
  day: {
    key: sql<string>`to_char(${transaction.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
  },
  key: {
    key: sql<string>`coalesce(${transaction.providerKeyId}::text, '')`,
    label: sql<
      string | null
    >`max(coalesce(nullif(${providerKey.label}, ''), '••••' || ${providerKey.hint}))`,
  },
  kind: { key: sql<string>`${transaction.kind}` },
  model: { key: sql<string>`${transaction.model}` },
  user: {
    key: sql<string>`${transaction.userId}::text`,
    label: sql<string | null>`max(${user.name})`,
  },
};

/** Postgres sums bigints as numeric, which arrives as text. */
const total = (column: SQL | typeof transaction.costMicros) =>
  sql`coalesce(sum(${column}), 0)`.mapWith(Number);
const optionalTotal = (column: typeof transaction.cachedInputTokens) =>
  sql<number | null>`sum(${column})`.mapWith((value) =>
    value === null ? null : Number(value)
  );

/** Spend in `[from, to)` grouped by `groupBy`, biggest first. */
export const summarizeUsage = async (
  db: Db,
  filter: UsageFilter,
  query: UsageQuery
): Promise<UsageSummaryRow[]> => {
  const group = GROUPS[query.groupBy];
  const rows = await db
    .select({
      cachedInputTokens: optionalTotal(transaction.cachedInputTokens),
      costMicros: total(transaction.costMicros),
      inputTokens: total(sql`${transaction.inputTokens}`),
      key: group.key,
      label: group.label ?? sql<string | null>`null`,
      outputTokens: total(sql`${transaction.outputTokens}`),
      reasoningTokens: optionalTotal(transaction.reasoningTokens),
    })
    .from(transaction)
    .leftJoin(run, eq(run.id, transaction.runId))
    .leftJoin(conversation, eq(conversation.id, run.conversationId))
    .leftJoin(providerKey, eq(providerKey.id, transaction.providerKeyId))
    .leftJoin(user, eq(user.id, transaction.userId))
    .where(
      and(
        filterWhere(filter),
        query.space ? filterWhere(query.space) : undefined,
        query.keyId ? eq(transaction.providerKeyId, query.keyId) : undefined,
        gte(transaction.createdAt, query.from),
        lt(transaction.createdAt, query.to)
      )
    )
    .groupBy(group.key)
    .orderBy(desc(total(transaction.costMicros)), group.key);
  return rows.map((row) => ({
    costMicros: row.costMicros,
    key: row.key,
    ...(row.label === null ? {} : { label: row.label }),
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      ...(row.cachedInputTokens === null
        ? {}
        : { cachedInputTokens: row.cachedInputTokens }),
      ...(row.reasoningTokens === null
        ? {}
        : { reasoningTokens: row.reasoningTokens }),
    },
  }));
};

/** Transactions matching `filter`, newest first. */
export const listTransactionsFor = async (
  db: Db,
  filter: UsageFilter,
  { cursor, limit }: { readonly cursor?: string; readonly limit: number }
): AsyncResult<Page<TransactionRow>, InvalidCursorError> => {
  const decoded = cursor ? decodeCursor(cursor) : undefined;
  if (decoded && !decoded.ok) {
    return err(decoded.error);
  }
  const rows = await db
    .select()
    .from(transaction)
    .where(
      and(
        filterWhere(filter),
        decoded?.ok
          ? lt(transaction.id, decoded.value.id as TransactionRow["id"])
          : undefined
      )
    )
    .orderBy(desc(transaction.id))
    .limit(limit + 1);
  return ok(
    toPage(rows, limit, (row) => ({
      id: row.id,
      key: row.createdAt.toISOString(),
    }))
  );
};

export const getBudget = async (
  db: Db,
  id: BudgetId
): AsyncResult<BudgetRow, NotFoundError> => {
  const [row] = await db.select().from(budget).where(eq(budget.id, id));
  return row ? ok(row) : err(notFound("budget", id));
};

export const deleteBudget = async (
  db: Db,
  id: BudgetId
): AsyncResult<void, NotFoundError> => {
  const deleted = await db
    .delete(budget)
    .where(eq(budget.id, id))
    .returning({ id: budget.id });
  return deleted.length > 0 ? ok(undefined) : err(notFound("budget", id));
};

/** Personal is stored as the personal org; the wire names only the kind. */
const toChatContextOf = (row: TransactionRow): Transaction["context"] => {
  switch (row.contextType) {
    case "personal":
      return { type: "personal" };
    case "team":
      return { id: row.contextId as TeamId, type: "team" };
    case "org":
      return { id: row.contextId as OrgId, type: "org" };
    default:
      return row.contextType satisfies never;
  }
};

export const toTransaction = (row: TransactionRow): Transaction => ({
  context: toChatContextOf(row),
  costMicros: row.costMicros,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  kind: row.kind,
  model: row.model,
  paidBy:
    row.paidByType === "instance" || row.paidById === null
      ? { type: "instance" }
      : ({ id: row.paidById, type: row.paidByType } as Transaction["paidBy"]),
  runId: row.runId,
  usage: {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    ...(row.cachedInputTokens === null
      ? {}
      : { cachedInputTokens: row.cachedInputTokens }),
    ...(row.reasoningTokens === null
      ? {}
      : { reasoningTokens: row.reasoningTokens }),
  },
  userId: row.userId,
});

export const toBudget = (status: BudgetStatus): Budget => ({
  hard: status.hard,
  id: status.id,
  limitMicros: status.limitMicros,
  period: status.period,
  principal: {
    id: status.principalId,
    type: status.principalType,
  } as Budget["principal"],
  resetsAt: status.resetsAt.toISOString(),
  usedMicros: status.usedMicros,
});
