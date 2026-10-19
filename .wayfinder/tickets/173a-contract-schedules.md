---
id: "173a"
title: "Contract: schedules target a conversation; run outcomes; notify policy"
labels: [wayfinder:build]
status: closed
assignee: claude (t-182 overnight, 2026-10-20)
blockedBy: ["172"]
---

## Question

The research doc (`.context/research/chatgpt-dots-and-sidebar.md` §A2 and "Schedules: a deep dive", branch `t/chatgpt-dots-sidebar-study`) found that ChatGPT's schedules are their own objects that target a thread. Connor's decision is one Dot per user, and the Dot is a thread; schedules are separate and can target it. This ticket is the contract for that, in its own PR.

## Done when

- A `schedules.*` group: list, get, create, update, delete, pause, resume, runNow, runs, markRunsRead and limits.
- `Schedule` has:
  - `target`: `dot`, `conversation` or `new_chat_each_run`;
  - `recurrence`: an RRULE with `startAt` and an IANA zone, or a legacy cron, plus `endsAt`;
  - `notify`, `status` and `pausedReason`;
  - `nextRunNominalAt`, and `nextRunAt` with jitter;
  - `readOnly`, `missedRunPolicy` and `autoApproveTools`.
- `ScheduleRun` has an outcome (update, no_update, needs_attention, failed or skipped), a skip reason, a summary, `notified`, `readAt` and `missedSlots`.
- `Dot.attention` exists; `Dot.schedules` is `Schedule[]`; `Conversation.schedule?` exists; the `dots.*Schedule` routes stay as aliases for one release.
- The zod schemas, the OpenAPI regeneration and the contract tests pass.

## Owns

`packages/contract/src/{schemas,routes}/{schedules,dots}.ts`, `schemas/{common,conversations}.ts`, `contract.ts`, `openapi.ts`, `openapi.json`, `scripts/generate-openapi.ts`.

## Resolution

Built on `t/173a-contract-schedules` as draft PR #139, which is contract-only and for Connor to merge. The OpenAPI spec passed 1 MiB, so its generator now raises biome's file-size cap. `bun run check` still warns that it skips that file.
