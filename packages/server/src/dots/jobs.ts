import { ok } from "@workspace/shared/result";
import {
  enqueueJob,
  type JobHandlers,
  type Jobs,
  jobDefaults,
} from "../jobs/registry";
import type { JobQueue } from "../ports/job-queue";
import { claimDue, fireSchedule, type ScheduleDeps } from "./schedules";

// The schedules' jobs (172, 173). pg-boss keeps one cron per job name, so instead of a
// pg-boss schedule per Dot schedule, one `dot.tick` runs every minute and
// claims whatever is due from `dot_schedule.next_run_at`; each claim
// becomes its own `dot.run` job, so a slow run never holds up the tick.

/** Every minute: the finest grain a Dot schedule has. */
export const DOT_TICK_CRON = "* * * * *";

export const dotJobHandlers = (
  deps: ScheduleDeps & { readonly queue: JobQueue<Jobs> | null }
): JobHandlers => ({
  "dot.run": async (job) => ok(await fireSchedule(deps, job.data.claimId)),
  "dot.tick": async () => {
    const claims = await claimDue(deps, deps.now());
    if (deps.queue) {
      for (const claimId of claims) {
        // biome-ignore lint/performance/noAwaitInLoops: a few due schedules a minute; each enqueue is one insert.
        await enqueueJob(
          deps.queue,
          "dot.run",
          { claimId },
          { singletonKey: `dot:${claimId}` }
        );
      }
    }
    return ok({ fired: claims.length });
  },
});

/** Puts the tick on its schedule; call once at boot, after registering handlers. */
export const scheduleDotTick = (queue: JobQueue<Jobs>) =>
  queue.schedule("dot.tick", DOT_TICK_CRON, {}, jobDefaults["dot.tick"]);
