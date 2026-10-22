import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import {
  baseErrors,
  type ConflictReason,
  conflictError,
} from "@workspace/contract/errors";
import type { Result } from "@workspace/shared/result";

import { actorFor, type RequestContext } from "../context";
import {
  createSchedule,
  getScheduleFor,
  listRunsFor,
  listSchedulesFor,
  markRunsRead,
  pauseSchedule,
  removeSchedule,
  resumeSchedule,
  runScheduleNow,
  scheduleLimitsFor,
  updateSchedule,
} from "../dots/schedules";
import {
  createDot,
  type DotDeps,
  type DotError,
  deleteDot,
  getDotFor,
  listDotActivity,
  listDotsFor,
  markDotRead,
  runDotNow,
  updateDot,
} from "../dots/service";

// The `dots` (172, 174) and `schedules` (173) procedure groups. Owner-only: someone else's Dot is
// `NOT_FOUND`. The handlers only translate; the work is in `dots/service`.

const validation = (message: string, path: readonly (string | number)[]) =>
  new ORPCError("VALIDATION", {
    data: { issues: [{ message, path: [...path] }] },
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });

type RunErrors = Partial<{
  readonly ALLOWANCE_SPENT: (options: {
    data: Extract<
      Extract<DotError, { type: "run" }>["error"],
      { type: "allowance_spent" }
    >["data"];
  }) => Error;
  readonly BUDGET_EXCEEDED: (options: {
    data: Extract<
      Extract<DotError, { type: "run" }>["error"],
      { type: "budget_exceeded" }
    >["data"];
  }) => Error;
  readonly CONFLICT: (options: { data: { reason: ConflictReason } }) => Error;
  readonly PROVIDER_UNAVAILABLE: (options: {
    data: { provider: null };
  }) => Error;
}>;

const conflict = (reason: ConflictReason, errors?: RunErrors): Error =>
  errors?.CONFLICT
    ? errors.CONFLICT({ data: { reason } })
    : new ORPCError("CONFLICT", {
        data: { reason },
        message: conflictError.CONFLICT.message,
        status: conflictError.CONFLICT.status,
      });

const failure = (error: DotError, errors?: RunErrors): Error => {
  switch (error.type) {
    case "not_found":
      return new ORPCError("NOT_FOUND");
    case "handle_taken":
      return validation("Another of your Dots has that handle.", ["handle"]);
    case "no_personal_space":
      return validation("You have no personal space yet.", []);
    case "no_dot":
      return validation("Make your Dot first.", ["target"]);
    case "forbidden":
      return new ORPCError("FORBIDDEN");
    case "dot_exists":
      return conflict("already_exists", errors);
    case "completed":
      return conflict("schedule_completed", errors);
    case "target_archived":
      return conflict("target_archived", errors);
    case "busy":
      return conflict("run_active", errors);
    case "cap":
      return new ORPCError("RATE_LIMITED", {
        data: { retryAfterSeconds: error.retryAfterSeconds },
        message: "You've used today's scheduled runs.",
        status: baseErrors.RATE_LIMITED.status,
      });
    case "invalid_rule":
    case "invalid_timezone":
    case "too_frequent":
    case "once_out_of_range":
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
          return errors?.CONFLICT
            ? errors.CONFLICT({ data: { reason: "context_locked" } })
            : new ORPCError("CONFLICT");
        case "budget_exceeded":
          return errors?.BUDGET_EXCEEDED
            ? errors.BUDGET_EXCEEDED({ data: run.data })
            : new ORPCError("BUDGET_EXCEEDED");
        case "allowance_spent":
          return errors?.ALLOWANCE_SPENT
            ? errors.ALLOWANCE_SPENT({ data: run.data })
            : new ORPCError("ALLOWANCE_SPENT");
        case "no_model":
          return errors?.PROVIDER_UNAVAILABLE
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
    activity: authed.dots.activity.handler(async ({ context, input }) =>
      unwrap(await listDotActivity(db, context.actor.userId, input))
    ),
    create: authed.dots.create.handler(async ({ context, errors, input }) =>
      unwrap(await createDot(deps, context.actor, input), errors)
    ),
    delete: authed.dots.delete.handler(async ({ context, input }) => {
      unwrap(await deleteDot(db, context.actor, input.id));
    }),
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
  };

  const schedules = {
    create: authed.schedules.create.handler(async ({ context, input }) =>
      unwrap(await createSchedule(deps, context.actor, input))
    ),
    delete: authed.schedules.delete.handler(async ({ context, input }) => {
      unwrap(await removeSchedule(db, context.actor, input.id));
    }),
    get: authed.schedules.get.handler(async ({ context, input }) =>
      unwrap(await getScheduleFor(db, context.actor.userId, input.id))
    ),
    limits: authed.schedules.limits.handler(({ context }) =>
      scheduleLimitsFor(deps, context.actor.userId)
    ),
    list: authed.schedules.list.handler(({ context, input }) =>
      listSchedulesFor(db, context.actor.userId, input)
    ),
    markRunsRead: authed.schedules.markRunsRead.handler(
      async ({ context, input }) => {
        unwrap(await markRunsRead(deps, context.actor, input.id));
      }
    ),
    pause: authed.schedules.pause.handler(async ({ context, input }) =>
      unwrap(await pauseSchedule(deps, context.actor, input.id))
    ),
    resume: authed.schedules.resume.handler(
      async ({ context, errors, input }) =>
        unwrap(await resumeSchedule(deps, context.actor, input.id), errors)
    ),
    runNow: authed.schedules.runNow.handler(
      async ({ context, errors, input }) =>
        unwrap(await runScheduleNow(deps, context.actor, input.id), errors)
    ),
    runs: authed.schedules.runs.handler(async ({ context, input }) =>
      unwrap(await listRunsFor(db, context.actor.userId, input))
    ),
    update: authed.schedules.update.handler(async ({ context, input }) =>
      unwrap(await updateSchedule(deps, context.actor, input))
    ),
  };

  return { dots, schedules };
};
