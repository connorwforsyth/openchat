import type { budgetExceededDataSchema } from "@workspace/contract/errors";
import type { OrgId, TeamId } from "@workspace/contract/schemas/common";
import type {
  ChatContext,
  Principal,
} from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import type { StoredContext } from "@workspace/db/queries/conversations";
import { personalOrgOf, teamLineage } from "@workspace/db/queries/teams";
import {
  budgetStatuses,
  exceededBudgets,
  recordTransaction,
} from "@workspace/db/queries/usage";
import { err, ok, type Result } from "@workspace/shared/result";
import type { z } from "zod";

import type { Actor } from "../context";
import type { RunSettled } from "./executor";

// Chat contexts as the database stores them (D17): Personal is the user's
// personal org, a team is a team id, an org an org id. Budgets are checked
// against the context before a run exists (D24), and usage is recorded
// against it once the run ends.

export type ContextProblem =
  | { readonly type: "no_personal_space" }
  | { readonly type: "not_a_member" };

/** The stored context for `context` as `actor` would use it, if they belong to it. */
export const storeContext = async (
  db: Db,
  actor: Actor,
  context: ChatContext
): Promise<Result<StoredContext, ContextProblem>> => {
  switch (context.type) {
    case "personal": {
      const orgId = await personalOrgOf(db, actor.userId);
      return orgId
        ? ok({ id: orgId, type: "personal" })
        : err({ type: "no_personal_space" });
    }
    case "team":
    case "org":
      return actor.principals.some(
        (principal) =>
          principal.type === context.type && principal.id === context.id
      )
        ? ok(context)
        : err({ type: "not_a_member" });
    default:
      return context satisfies never;
  }
};

/** Everyone a run in `context` charges: the user, the team chain, the org. */
export const chargedBy = async (
  db: Db,
  userId: Actor["userId"],
  context: StoredContext
): Promise<{ orgId: OrgId; principals: Principal[] } | null> => {
  if (context.type !== "team") {
    return {
      orgId: context.id,
      principals: [
        { id: userId, type: "user" },
        { id: context.id, type: "org" },
      ],
    };
  }
  const lineage = await teamLineage(db, context.id as TeamId);
  return lineage
    ? {
        orgId: lineage.orgId,
        principals: [
          { id: userId, type: "user" },
          ...lineage.path.map((id): Principal => ({ id, type: "team" })),
          { id: lineage.orgId, type: "org" },
        ],
      }
    : null;
};

export type BudgetExceededData = z.infer<typeof budgetExceededDataSchema>;

/** The pre-run budget check (D24): `err` with the first hard budget that's spent. */
export type BudgetCheck = (
  actor: Actor,
  context: StoredContext
) => Promise<Result<void, BudgetExceededData>>;

export const budgetCheck =
  (db: Db, now: () => Date = () => new Date()): BudgetCheck =>
  async (actor, context) => {
    const charged = await chargedBy(db, actor.userId, context);
    if (!charged) {
      return ok(undefined);
    }
    const at = now();
    const spent = exceededBudgets(
      await budgetStatuses(db, charged.orgId, charged.principals, at)
    ).find((status) => status.hard);
    return spent
      ? err({
          limitMicros: spent.limitMicros,
          period: spent.period,
          principal: {
            id: spent.principalId,
            type: spent.principalType,
          } as Principal,
          resetsAt: spent.resetsAt.toISOString(),
          usedMicros: spent.usedMicros,
        })
      : ok(undefined);
  };

/**
 * Records a finished run's model usage against the user and the context.
 * Cost is zero until model prices land in config (the usage workstream);
 * the tokens are what the balances will be recomputed from.
 */
export const recordRunUsage = async (
  db: Db,
  { run, turn, usage }: RunSettled
): Promise<void> => {
  if (!(usage && turn)) {
    return;
  }
  const context = { id: run.contextId, type: run.contextType } as StoredContext;
  const charged = await chargedBy(db, run.createdBy, context);
  if (!charged) {
    return;
  }
  await recordTransaction(db, {
    context,
    costMicros: 0,
    kind: "chat",
    model: turn.resolvedModel,
    orgId: charged.orgId,
    paidBy: turn.paidBy ?? { type: "instance" },
    runId: run.id,
    usage,
    userId: run.createdBy,
  });
};
