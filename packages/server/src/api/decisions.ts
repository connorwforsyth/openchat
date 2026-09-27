import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type { Db } from "@workspace/db/client";
import {
  listDecisions,
  toDecisionLogEntry,
} from "@workspace/db/queries/decisions";

import type { RequestContext } from "../context";
import { isInstanceAdmin } from "./roles";

// The `decisions` procedure group (D15): the Decider's log, for instance
// admins auditing and tuning it. Entries quote users' turns, so nobody else
// reads it, org admins included.

export interface DecisionsDeps {
  readonly db: Db;
}

export const createDecisionsRouter = ({ db }: DecisionsDeps) => {
  const os = implement(contract).$context<RequestContext>();
  const admin = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    if (!(await isInstanceAdmin(db, context.session.userId))) {
      throw new ORPCError("FORBIDDEN", baseErrors.FORBIDDEN);
    }
    return next();
  });

  const decisions = {
    list: admin.decisions.list.handler(async ({ input }) => {
      const page = await listDecisions(db, {
        conversationId: input.conversationId,
        cursor: input.cursor,
        limit: input.limit,
        purpose: input.purpose,
        runId: input.runId,
      });
      if (!page.ok) {
        throw new ORPCError("VALIDATION", {
          data: { issues: [{ message: "Unknown cursor.", path: ["cursor"] }] },
          message: baseErrors.VALIDATION.message,
          status: baseErrors.VALIDATION.status,
        });
      }
      return {
        items: page.value.items.map(toDecisionLogEntry),
        nextCursor: page.value.nextCursor,
      };
    }),
  };

  return { decisions };
};
