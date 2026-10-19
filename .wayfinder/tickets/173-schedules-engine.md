---
id: "173"
title: "Schedules engine: heartbeats on any chat, RRULE recurrence, defer/collapse, archive coupling"
labels: [wayfinder:build]
status: closed
assignee: claude (t-182 overnight, 2026-10-20)
blockedBy: ["173a"]
---

## Done when

- **Targets:** a schedule can target the owner's Dot thread, any chat the owner can write, or a new chat each run, titled `<task> · <date>`.
  - The run's message carries a `scheduled-task` data part, and the chat labels it "Sent by scheduled task".
- **Recurrence:** RRULE in an IANA zone, covering one-off (`COUNT=1`, no more than two years ahead), minutely and hourly intervals, daily, weekly with days and `INTERVAL`, monthly and yearly, plus an end date.
  - Wall-clock rules stay correct across DST.
  - A one-off is completed once it fires.
  - Legacy cron still works.
- **Jitter:** round-minute slots get a deterministic offset of up to ±5 minutes; the UI shows the true time.
- **Busy target:** the run is deferred by 60 s and retried until the next slot arrives, then the slot is skipped as `busy`.
- **Missed slots:** they collapse into one run (`run_once`), or are skipped with `skip`. `missedSlots` is recorded.
- **Controls:** pause, resume, run now and run history, with skipped slots recorded.
- **Archiving:** archiving the target chat pauses its schedules (`target_archived`), and resume is refused until the chat is unarchived. Deleting the chat deletes its schedules.
- **Migration:** existing Dot schedules become `target = dot` with `notify = all`.

## Owns

- `packages/ai/src/schedules/**`, the pure core: recurrence, describe, parse-when, zoned and the tool schemas.
- `packages/db/src/{schema,queries}/dots.ts` and migration `20261019140208_schedules`.
- `packages/server/src/dots/**`, `packages/server/src/api/dots.ts`, `jobs/registry.ts`, and the schedule summary and archive hook in `api/router.ts`.

## Resolution

Built in `t/182-dots-engine-ux`.

- **Pure tests:** RRULE parsing, DST in London and New York, intervals, one-offs, `endsAt`, jitter bounds and determinism, missed slots, and `planDue`, which decides fire, defer, busy-skip, cap-skip, missed-skip, complete or gone.
- **PGlite API tests:** targets, archive coupling, defer then skip, the cap, a new chat each run, one-off completion and limits.
- **Not built:**
  - The archive API doesn't report how many schedules it paused.
  - There's no PGlite test that runs the merge-down migration over seeded rows. It was exercised by hand on a copy of the demo DB: 3 Dots became 1, and the other 2 Dots' schedules became chat schedules.
