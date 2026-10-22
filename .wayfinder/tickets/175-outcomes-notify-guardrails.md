---
id: "175"
title: "Run outcomes, notify policy and cost guardrails"
labels: [wayfinder:build]
status: closed
assignee: claude (t-182 overnight, 2026-10-20)
blockedBy: ["173a"]
---

## Done when

- **Outcomes:** every unattended run gets a `report_outcome` tool, with outcome `update`, `no_update` or `needs_attention` plus a summary. The loop stops after that call, so a quiet run costs one step.
  - Without a report, the outcome falls back to the reply: text is `update`; empty, or `DONT_NOTIFY`, is `no_update`.
  - A failed run is `failed`.
- **Notify:** `shouldNotify(outcome, policy)`.
  - `all` notifies for everything except `no_update`.
  - `failures` notifies only for failed runs.
  - `important` notifies for `needs_attention` and failed runs.
  - `none` never notifies.
  - Only notified runs count as unread or attention. `no_update` leaves no unread, and the transcript folds it into one line.
- **Guardrails** come from `app.config.yaml` `schedules:` and are enforced on the server:
  - `minIntervalMinutes` (60) is checked at create and update;
  - `maxRunsPerUserPerDay` (24, rolling, "Run now" included) skips the slot as `skipped: cap`, and makes "Run now" return `RATE_LIMITED`;
  - `runStepBudget` (8) and `runTokenBudget` (20k): going over either fails the run with `budget_exceeded`;
  - `defaultModel` (null, meaning `fast` if that alias exists, else the cheap or default model) answers schedules on ordinary chats.
- **Read-only heartbeats:** on a non-Dot chat they get plan mode's read-only filter unless `readOnly: false`. Unattended runs never ask.
- `schedules.limits` exposes the guardrails and today's usage.

## Owns

`packages/server/src/dots/{schedule-policy,report-tool,turn,jobs}.ts`, `packages/config/src/schema.ts` (`schedules:`), `app.config.example.yaml`, and the `budget` and `stopAfterTools` fields on `Turn` and `runAgent`.

## Resolution

Built in `t/182-dots-engine-ux`.

- **Tests:** the pure `shouldNotify`, `concludeRun` and `checkRecurrence`, and the config schema defaults. Turn tests check that the guards add the report tool, stop after it and carry the budget, and that read-only withholds writes. PGlite plus `MockLanguageModelV4` tests check that `no_update` ends after one step with no unread, that `needs_attention` sets attention, and that going over the token budget fails the run.
- No live provider calls.
