import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type { Result } from "@workspace/shared/result";

import { actorFor, type RequestContext } from "../context";
import {
  addDotSchedule,
  createDot,
  type DotDeps,
  type DotError,
  deleteDot,
  editDotSchedule,
  getDotFor,
  listDotsFor,
  markDotRead,
  removeDotSchedule,
  runDotNow,
  updateDot,
} from "../dots/service";

// The `dots` procedure group (172). Owner-only: someone else's Dot is
// `NOT_FOUND`. The handlers only translate; the work is in `dots/service`.

const validation = (message: string, path: readonly (string | number)[]) =>
  new ORPCError("VALIDATION", {
    data: { issues: [{ message, path: [...path] }] },
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });

interface RunErrors {
  readonly BUDGET_EXCEEDED: (options: {
    data: Extract<
      Extract<DotError, { type: "run" }>["error"],
      { type: "budget_exceeded" }
    >["data"];
  }) => Error;
  readonly CONFLICT: (options: { data: { reason: "context_locked" } }) => Error;
  readonly PROVIDER_UNAVAILABLE: (options: {
    data: { provider: null };
  }) => Error;
}

const failure = (error: DotError, errors?: RunErrors): Error => {
  switch (error.type) {
    case "not_found":
      return new ORPCError("NOT_FOUND");
    case "no_personal_space":
      return validation("You have no personal space yet.", []);
    case "invalid_cron":
    case "invalid_timezone":
      return validation(error.message, error.path);
    case "run": {
      const run = error.error;
      switch (run.type) {
        case "not_found":
          return new ORPCError("NOT_FOUND");
        case "forbidden":
          return new ORPCError("FORBIDDEN");
        case "invalid":
          return validation(run.message, run.path);
        case "context_locked":
          return errors
            ? errors.CONFLICT({ data: { reason: "context_locked" } })
            : new ORPCError("CONFLICT");
        case "budget_exceeded":
          return errors
            ? errors.BUDGET_EXCEEDED({ data: run.data })
            : new ORPCError("BUDGET_EXCEEDED");
        case "no_model":
          return errors
            ? errors.PROVIDER_UNAVAILABLE({ data: { provider: null } })
            : new ORPCError("PROVIDER_UNAVAILABLE");
        default:
          return run satisfies never;
      }
    }
    default:
      return error satisfies never;
  }
};

const unwrap = <T>(result: Result<T, DotError>, errors?: RunErrors): T => {
  if (!result.ok) {
    throw failure(result.error, errors);
  }
  return result.value;
};

export const createDotsRouter = (deps: DotDeps) => {
  const { db } = deps;
  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context: { actor: await actorFor(db, context.session) } });
  });

  const dots = {
    create: authed.dots.create.handler(async ({ context, input }) =>
      unwrap(await createDot(deps, context.actor, input))
    ),
    createSchedule: authed.dots.createSchedule.handler(
      async ({ context, input }) =>
        unwrap(await addDotSchedule(deps, context.actor, input))
    ),
    delete: authed.dots.delete.handler(async ({ context, input }) => {
      unwrap(await deleteDot(db, context.actor, input.id));
    }),
    deleteSchedule: authed.dots.deleteSchedule.handler(
      async ({ context, input }) => {
        unwrap(await removeDotSchedule(db, context.actor, input.id));
      }
    ),
    get: authed.dots.get.handler(async ({ context, input }) =>
      unwrap(await getDotFor(db, context.actor.userId, input.id))
    ),
    list: authed.dots.list.handler(({ context }) =>
      listDotsFor(db, context.actor.userId)
    ),
    markRead: authed.dots.markRead.handler(async ({ context, input }) =>
      unwrap(await markDotRead(deps, context.actor, input.id))
    ),
    runNow: authed.dots.runNow.handler(async ({ context, errors, input }) =>
      unwrap(await runDotNow(deps, context.actor, input), errors)
    ),
    update: authed.dots.update.handler(async ({ context, input }) =>
      unwrap(await updateDot(deps, context.actor, input))
    ),
    updateSchedule: authed.dots.updateSchedule.handler(
      async ({ context, input }) =>
        unwrap(await editDotSchedule(deps, context.actor, input))
    ),
  };

  return { dots };
};
