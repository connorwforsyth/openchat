import { implement, ORPCError } from "@orpc/server";
import { orgRoleOf } from "@workspace/auth/resources";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  loadPrincipals,
  personalOrgOf,
  teamSubtree,
} from "@workspace/db/queries/teams";
import {
  budgetStatuses,
  deleteBudget,
  getBudget,
  listBudgets,
  listTransactionsFor,
  type SpaceScope,
  setBudget,
  summarizeUsage,
  toBudget,
  toTransaction,
  type UsageFilter,
} from "@workspace/db/queries/usage";

import type { RequestContext } from "../context";
import {
  administersTeam,
  isInstanceAdmin,
  isOrgAdmin,
  managesKeys,
  teamOrg,
} from "./roles";

// The `usage` procedure group (D17, D24). Who sees what:
// - a user sees their own usage, in every context;
// - a team's totals (its chats and its sub-teams') are for whoever
//   administers the team: a team admin of it or a team above it, or an org
//   owner or admin;
// - an org's totals (everything recorded in it) are for its owners and admins.
// Budgets are managed by org owners and admins only, team budgets included
// (team admins don't set their own caps). A user's own budget lives in their
// personal org, which they own, so they can cap their personal spend.
// Usage by chat names chats, so it's only for your own usage, and a chat is
// titled only while you can read it. A key is named only to whoever
// `keys.list` would show it to.

export interface UsageDeps {
  readonly db: Db;
  /** The clock budgets' periods are read against. */
  readonly now?: () => Date;
  /** A person's page in the trace viewer, when the instance names one (`observability.userTracesUrl`). */
  readonly userTracesUrl?: (userId: UserId) => string;
}

const forbidden = () => new ORPCError("FORBIDDEN", baseErrors.FORBIDDEN);
const notFound = () => new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);
const validation = (message: string, path: (string | number)[]) =>
  new ORPCError("VALIDATION", {
    data: { issues: [{ message, path }] },
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });

export const createUsageRouter = ({
  db,
  now = () => new Date(),
  userTracesUrl,
}: UsageDeps) => {
  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    return next({ context: { userId: context.session.userId } });
  });

  /** The principal as a typed union, from the flat query-string pair. */
  const principalOf = (input: {
    readonly principalId: string;
    readonly principalType: Principal["type"];
  }): Principal =>
    ({ id: input.principalId, type: input.principalType }) as Principal;

  /** Whose transactions the caller may read for `principal`; `FORBIDDEN` otherwise. */
  const readableUsage = async (
    userId: UserId,
    principal: Principal
  ): Promise<UsageFilter> => {
    switch (principal.type) {
      case "user":
        if (principal.id !== userId) {
          throw forbidden();
        }
        return { type: "user", userId };
      case "team":
        if (!(await administersTeam(db, principal.id, userId))) {
          throw forbidden();
        }
        return { teamIds: await teamSubtree(db, principal.id), type: "team" };
      case "org":
        if (!(await isOrgAdmin(db, principal.id, userId))) {
          throw forbidden();
        }
        return { orgId: principal.id, type: "org" };
      default:
        return principal satisfies never;
    }
  };

  /** The space a summary is narrowed to; a team's includes its sub-teams. */
  const spaceScope = async (input: {
    readonly spaceId?: string;
    readonly spaceType?: "org" | "team";
  }): Promise<SpaceScope | undefined> => {
    switch (input.spaceType) {
      case undefined:
        return;
      case "org":
        return { orgId: input.spaceId as OrgId, type: "org" };
      case "team":
        return {
          teamIds: await teamSubtree(db, input.spaceId as TeamId),
          type: "team",
        };
      default:
        return input.spaceType satisfies never;
    }
  };

  /** Whether `principal` is in `orgId`: the org itself, one of its teams, or a member. */
  const belongsTo = async (
    principal: Principal,
    orgId: OrgId
  ): Promise<boolean> => {
    switch (principal.type) {
      case "org":
        return principal.id === orgId;
      case "team":
        return (await teamOrg(db, principal.id)) === orgId;
      case "user":
        return (await orgRoleOf(db, orgId, principal.id)) !== null;
      default:
        return principal satisfies never;
    }
  };

  /**
   * The org a budget for `principal` belongs to when the caller doesn't say
   * (deprecated, 042): its own org, a user's personal one. `null` when
   * there's none.
   */
  const budgetOrg = (principal: Principal): Promise<OrgId | null> => {
    switch (principal.type) {
      case "org":
        return Promise.resolve(principal.id);
      case "team":
        return teamOrg(db, principal.id as TeamId);
      case "user":
        return personalOrgOf(db, principal.id);
      default:
        return principal satisfies never;
    }
  };

  const usage = {
    budgets: authed.usage.budgets.handler(async ({ context, input }) => {
      if (!(await isOrgAdmin(db, input.orgId, context.userId))) {
        throw forbidden();
      }
      const rows = await listBudgets(db, input.orgId);
      const principals = [
        ...new Map(
          rows.map((row) => [
            `${row.principalType}:${row.principalId}`,
            { id: row.principalId, type: row.principalType } as Principal,
          ])
        ).values(),
      ];
      const statuses = await budgetStatuses(db, input.orgId, principals, now());
      return statuses.map(toBudget);
    }),

    deleteBudget: authed.usage.deleteBudget.handler(
      async ({ context, input }) => {
        const found = await getBudget(db, input.id);
        if (
          !(
            found.ok &&
            (await isOrgAdmin(db, found.value.orgId, context.userId))
          )
        ) {
          throw notFound();
        }
        await deleteBudget(db, input.id);
      }
    ),

    setBudget: authed.usage.setBudget.handler(async ({ context, input }) => {
      const orgId = input.orgId ?? (await budgetOrg(input.principal));
      if (!orgId) {
        throw notFound();
      }
      if (!(await isOrgAdmin(db, orgId, context.userId))) {
        throw forbidden();
      }
      if (input.orgId && !(await belongsTo(input.principal, input.orgId))) {
        throw validation("The principal isn't in this org.", ["principal"]);
      }
      const row = await setBudget(db, {
        hard: input.hard,
        limitMicros: input.limitMicros,
        orgId,
        period: input.period,
        principal: input.principal,
      });
      const [status] = (
        await budgetStatuses(db, orgId, [input.principal], now())
      ).filter((each) => each.id === row.id);
      if (!status) {
        throw new Error("budget vanished after upsert");
      }
      return toBudget(status);
    }),

    summary: authed.usage.summary.handler(async ({ context, input }) => {
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (from >= to) {
        throw validation("`from` must be before `to`.", ["from"]);
      }
      const principal = principalOf(input);
      if (input.groupBy === "conversation" && principal.type !== "user") {
        throw validation("Usage by chat is only for your own usage.", [
          "groupBy",
        ]);
      }
      const filter = await readableUsage(context.userId, principal);
      const summarized = await summarizeUsage(db, filter, {
        from,
        groupBy: input.groupBy,
        keyId: input.keyId,
        space: await spaceScope(input),
        to,
        viewer:
          input.groupBy === "conversation"
            ? {
                principals: await loadPrincipals(db, context.userId),
                userId: context.userId,
              }
            : undefined,
      });
      const rows = await Promise.all(
        summarized.map(async ({ keyScope, label, ...row }) =>
          label !== undefined &&
          (keyScope === undefined ||
            (await managesKeys(db, context.userId, keyScope)))
            ? { ...row, label }
            : row
        )
      );
      const traced =
        userTracesUrl &&
        input.groupBy === "user" &&
        (await isInstanceAdmin(db, context.userId));
      return {
        from: from.toISOString(),
        principal,
        rows: traced
          ? rows.map((row) => ({
              ...row,
              traceUrl: userTracesUrl(row.key as UserId),
            }))
          : rows,
        to: to.toISOString(),
        totalCostMicros: rows.reduce((sum, row) => sum + row.costMicros, 0),
      };
    }),

    transactions: authed.usage.transactions.handler(
      async ({ context, input }) => {
        const filter = await readableUsage(context.userId, principalOf(input));
        const page = await listTransactionsFor(db, filter, {
          cursor: input.cursor,
          limit: input.limit,
        });
        if (!page.ok) {
          throw validation("Unknown cursor.", ["cursor"]);
        }
        return {
          items: page.value.items.map(toTransaction),
          nextCursor: page.value.nextCursor,
        };
      }
    ),
  };

  return { usage };
};
