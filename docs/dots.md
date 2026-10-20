# Dots: always-on scheduled agents

> **Since 173–175 and 183:** one Dot per user, and the Dot is a thread.
> Schedules are separate objects (`schedules.*`) that target the Dot's
> thread, any chat you can write, or a new chat each run. See
> [Schedules](#schedules-173-175-183) below. The rest of this page
> describes 172, and some of it (several Dots, a primary picker, cron-only
> schedules) is superseded.

A **Dot** is a persistent agent: a model plus instructions, or a published
library agent (which brings its own tools, MCP servers and skills). Each Dot
has its own conversation, its own workspace (sandbox) and one or more cron
schedules. Every run, scheduled or "Run now", posts the schedule's prompt into
the Dot's conversation and answers it there. The `/dots` page shows each Dot's
status, next run, last result and an unread marker.

Ticket 172. Contract changes are in their own branch (`t/172a-contract-dots`).

## The Dot home (identity first)

A Dot is someone you talk to, not a cron form. It has a name, an animated
avatar (`orb|blob|ring|spark|pebble` in a theme colour `--dot-*`; it breathes
with transform/opacity only, still under reduced motion), an `@handle`
(unique per owner) and one **primary** Dot per owner (a partial unique index;
the first Dot is primary, deleting it promotes the newest remaining one).

- **Onboarding** (`/dots` with no Dots, or "New Dot"): name it, pick a look,
  say what it helps with (or pick Daily brief / Follow-up monitor / Weekly
  review, which adds a starter schedule), then straight into its chat.
- **Sidebar**: the primary Dot sits at the top with its avatar; the others are
  listed under "Dots" (`ChatSidebar`'s `top` and `dots` slots).
- **Home = its conversation**: the composer says "Message <name>"; the bar
  above shows status, Check in now, Profile, and a Call slot. If it ran while
  you were away, a "While you were away, I ran N tasks" card tops the chat.
- **Profile** (side sheet): Activity (`dots.activity`: runs, status, trigger),
  Scheduled (the schedules editor), Rules (free-text "when to ask first" plus
  tools it may use unattended), Computer (slot), Memory (the owner's memory;
  a Dot runs as its owner).
- **Conversational scheduling**: every turn in a Dot's chat gets its persona
  and two tools: `schedule_task` (create; asks for approval when you're there,
  refused unattended unless auto-approved) and `manage_scheduled_tasks`
  (list/pause/resume its own; never asks).
- **Extension slots** (`apps/web/app/(app)/(pages)/dots/dot-extensions.tsx`):
  `CallButton`, `ComputerTab`, `ComputerTabLabel`, each
  `ComponentType<{ dot: Dot }> | null`; `DotHome`/`DotProfile` also take an
  `extensions` prop. Filled: `CallButton` is the voice call (docs/voice.md)
  with the Dot's own face in the orb, reaching the chat through
  `VoiceBridgeContext` (the header's call stays for other chats);
  `ComputerTab`/`ComputerTabLabel` are the live view below.

## Architecture

```
            every minute (pg-boss cron "dot.tick")
                          │
              claimDueDotSchedules (FOR UPDATE SKIP LOCKED)
              moves next_run_at on with nextRunAt(cron, tz, now)
                          │ one job per occurrence
                          ▼
                 "dot.run" { scheduleId, occurrence }
                          │ fireDotSchedule: re-checks Dot + schedule enabled,
                          │ skips if the last run is still going
                          ▼
   createUnattendedRun(as owner, unattended { type: "schedule", scheduleId },
                       idempotencyKey "dot:s:<schedule>:<occurrence>")
                          │ in-process executor
                          ▼
   turn resolver ─► withChatMemory ─► withDotPolicy (unattended rules)
                          │
                 onSettled: settleDotRun → schedule.lastStatus,
                            auto-pause after 3 failures in a row
```

- **Tables** (`packages/db/src/schema/dots.ts`): `dot` (owner, name, target,
  instructions, sandbox provider, auto-approved tools, conversation,
  enabled, last viewed), `dot_schedule` (cron, timezone, prompt, enabled,
  last run, next run, last status) and `dot_run` (which runs a Dot started,
  and why).
- **Why one tick, not a pg-boss schedule per Dot schedule:** pg-boss keeps one
  cron per queue name, and the `JobQueue` port's `schedule(name, …)` is
  frozen. The database is the source of truth for `next_run_at`; the tick
  claims due rows with `skip locked`, so two web processes (or a later
  `apps/worker`) never fire one occurrence twice. Minute granularity.
- **Idempotency:** a scheduled run's key is `dot:s:<scheduleId>:<occurrence>`,
  so a retried `dot.run` job returns the same run instead of posting again.
  The `dot:` prefix is the server's: `runs.create` refuses a client key that
  starts with it.
- **Unattended policy** (`packages/server/src/dots/policy.ts`,
  `unattendedApproval`): on a Dot's run, a tool that would ask for approval
  is withheld and a call to it is answered with a clear tool error, unless the
  Dot lists the tool in `autoApproveTools`. A Dot's run never pauses for an
  approval. Manual chat in the Dot's conversation keeps normal approvals. The
  policy keys off the run's `unattended` column, which only
  `createUnattendedRun` sets (the schedules engine and a Dot's check-in),
  never off its idempotency key. A run's schedule loads only when the run's
  creator owns it, and a Dot's persona and approvals apply only to its
  owner's runs. A server-started run whose schedule is gone runs read-only
  with nothing auto-approved.
- **Standing instructions** join the turn's system instructions (not the
  posted message), with a note that nobody is watching.
- **Access:** the run is created as the Dot's owner, through `createRun`,
  which re-checks write access to the conversation and `use` of the agent.
- **Workspace:** with a `sandboxProvider` set, the Dot's conversation gets its
  workspace on that provider before the first run; otherwise the run's tools
  create the instance default on first use (and fall back to just-bash when
  Docker is down, as every chat does).
- **Unread:** a run that finished after the owner last opened the Dot.
  Opening it from the list, or viewing its chat (the schedule header),
  calls `dots.markRead`.

Code map:

| Where | What |
|---|---|
| `packages/contract/src/{schemas,routes}/dots.ts` | the `dots` procedure group |
| `packages/db/src/{schema,queries}/dots.ts` | tables and queries |
| `packages/server/src/dots/policy.ts` | pure core: `nextRunAt`, `unattendedApproval`, status, unread, auto-pause |
| `packages/server/src/dots/turn.ts` | `withDotPolicy` turn wrapper |
| `packages/server/src/dots/service.ts` | the shell: CRUD, `startDotRun`, `fireDotSchedule`, `settleDotRun` |
| `packages/server/src/dots/jobs.ts` | `dot.tick` and `dot.run` handlers |
| `packages/server/src/api/dots.ts` | oRPC handlers |
| `apps/web/app/(app)/(pages)/dots/` | the page, dialog, schedule presets and the chat's schedule header |

## The Dot's computer

Every Dot has its own computer: a Linux desktop (Xvfb, openbox, Chromium)
in a `desktop` sandbox on the sandbox runner, one per Dot conversation, with
its own volume so Chromium's profile (cookies, sign-ins) persists. The
`computer` tool (`packages/sandbox/src/computer/`) drives it with xdotool
(`screenshot`, `click`, `double_click`, `move`, `type`, `key`, `scroll`,
`wait`, `open_browser`) and shows the model a screenshot after every action.
It's a plain function tool, so it works with any vision model through the
gateway. Only the latest three screenshots reach the model
(`packages/ai/src/agent/tool-images.ts`), and none are stored in the chat.

- **Approval:** the tool never asks; the computer is the Dot's own. It joins
  every turn in a Dot's conversation (`withDotComputer`) before the
  unattended policy, which still withholds anything else that asks.
- **Live view:** the Dot bar's Computer button opens the Workspace panel,
  where the screen is pinned; the profile's Computer tab shows it too (its
  label goes live while the Dot works). The screen is noVNC
  through the preview proxy ( `{id}-6080.sandbox.localhost:7071`),
  view-only. **Take over** gives the owner mouse and keyboard and makes the
  tool refuse input (a flag file in the desktop) until **Give back control**.
  Plain routes `GET /api/computer/:conversationId` and
  `POST /api/computer/:conversationId/control` (owner only).
- **Image:** `docker build -t sandbox-desktop:latest apps/sandbox-runner/desktop`
  (or `docker compose --profile sandbox-desktop-build build sandbox-desktop`);
  the runner's `SANDBOX_DESKTOP_IMAGE` names it. The runner needs `open`
  egress (or an allowlist proxy) for the browser to reach the web.

## Remote sandbox

The Docker provider talks to `apps/sandbox-runner` over an authenticated HTTP
API, so the runner can live on another machine (a VPS with Docker and,
ideally, gVisor) while `web` stays socket-free:

1. On the sandbox host, run the runner from `apps/sandbox-runner` (see its
   README), e.g. `docker compose --profile sandbox up -d sandbox-runner
   docker-socket-proxy`, with a long random `SANDBOX_RUNNER_TOKEN`. Expose
   port 7070 only to the web host (private network, WireGuard/Tailscale, or a
   TLS reverse proxy); never to the internet unauthenticated.
2. On the web host, in `app.config.yaml`:

   ```yaml
   sandbox:
     default: docker
     docker:
       runnerUrl: "https://sandbox.internal.example:7070"
       token: "${SANDBOX_RUNNER_TOKEN}"
       runtime: runsc
   ```

3. In the Dot dialog pick **Workspace: Docker (sandbox runner)**. Each Dot's
   conversation gets one container on the remote host, with its own volume,
   so files persist between runs (the demo's `/work/brief.log` grows by one
   line per run).

If the runner is unreachable when a Dot's workspace is first created, the
workspace falls back to just-bash; an existing Docker workspace keeps its
provider and recovers when the runner is back.

## Demo: a "Morning brief" Dot every minute

Needs Postgres (`docker compose up -d`), a configured model provider (or
Ollama running locally), and optionally the sandbox runner
(`docker compose --profile sandbox up -d`).

1. `bun install`, then `bun run db:migrate` (or let the app migrate at boot)
   and `bun dev`. Set `CONFIG_PATH` to the repo's `app.config.yaml` if you run
   `next dev` from `apps/web` directly.
2. Sign in, open **Dots** in the sidebar, and press **Daily brief** (a template
   at 8am) or **New Dot**:
   - Name: `Morning brief`; Model: any available model (a cheap/fast one).
   - Instructions: `You are a terse morning-brief agent. Always use the bash
     tool in your workspace; never invent output.`
   - Workspace: `Docker (sandbox runner)`, or `Simulated (just-bash)` with no
     Docker.
   - Tools it may use without asking: `bash` (on an agent with MCP servers,
     add any MCP tool names you want it to run unattended).
   - Schedule: **Every minute (for testing)**, task: ``Morning brief: with
     bash, run `date -u`, `uname -sm`, append the date to /work/brief.log and
     run `wc -l /work/brief.log`. Then reply with 3 short bullets.``
3. Within a minute the pill goes **Running**, then the row shows the reply's
   first line with an unread dot. Open it: the Dot's chat, with the bash calls
   and the brief, and a schedule header with **Run now**.
4. Turn the Dot off with its switch when you're done; an every-minute Dot
   spends model tokens every minute.

The same through the API (cookie from signing in):

```sh
curl -b cookies -H 'content-type: application/json' http://localhost:3000/api/dots -d '{
  "name": "Morning brief",
  "target": { "type": "model", "model": "fast" },
  "instructions": "Always use the bash tool in your workspace.",
  "sandboxProvider": "docker",
  "autoApproveTools": ["bash"],
  "schedules": [{ "cron": "* * * * *", "timezone": "UTC",
                  "prompt": "Run date -u and uname -sm with bash, then report." }]
}'
curl -b cookies http://localhost:3000/api/dots          # status, lastRun, unread
curl -b cookies -X POST http://localhost:3000/api/dots/<id>/run -H 'content-type: application/json' -d '{}'
```

## Schedules (173–175, 183)

- **Object:** the `dot_schedule` table keeps its 172 name, and its rows are schedules.
  - Fields: `owner_id`, `target_kind` (`dot | conversation | new_chat_each_run`), a nullable `dot_id` and `conversation_id`, `title` and `prompt`.
  - Recurrence: `rrule` + `start_at` + `timezone`, or a legacy `cron`, plus `ends_at`.
  - Settings: `notify`, `read_only`, `missed_run_policy` and `auto_approve_tools`.
  - State: `enabled`, `paused_reason`, `completed_at`, `next_run_at` (with jitter) and `next_run_nominal_at`.
  - History: `dot_run` is the run history, including skipped slots, with outcome, summary, `notified`, `read_at` and `missed_slots`.
- **Recurrence** lives in the pure `packages/ai/src/schedules/recurrence.ts`.
  - It takes an RRULE subset: MINUTELY to YEARLY, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, BYHOUR, BYMINUTE, and COUNT=1 for a one-off.
  - Wall-clock rules compile to cron and expand with cron-parser, so 09:00 stays 09:00 across DST. Intervals count elapsed time from `startAt`.
  - Slots on a round minute get a deterministic jitter of up to ±5 minutes. The UI shows the nominal time.
- **The tick** (`planDue` in `dots/schedule-policy.ts`) decides what to do with each due row:
  - overdue slots collapse into one run (`missedSlots` counts the others), or with `skip` they're recorded as skipped;
  - a busy target (a run in flight or awaiting approval) defers the slot by 60 s, until the next slot would arrive, and then the slot is skipped as `busy`;
  - when the daily cap is used up, the slot is skipped as `cap`;
  - a one-off is completed once it fires;
  - a chat schedule whose target chat is gone is paused.
- **Posting:** the run posts as the owner through `createRun`. The message carries a `scheduled-task` data part, shown as "Sent by scheduled task · <name>". A new chat each run is titled `<name> · <date>`.
- **Unattended guards** (`dots/turn.ts`):
  - `ask` tools are refused unless auto-approved;
  - an ordinary chat's schedule is read-only by default (plan mode's filter);
  - a `report_outcome` tool ends the loop;
  - a step and token budget applies, and going over fails the run with `budget_exceeded`.
- **Outcome:** the report wins. Without one, text means `update`, and empty or `DONT_NOTIFY` means `no_update`.
  - `shouldNotify(outcome, notify)` decides whether the run counts as unread.
  - Quiet runs leave no unread, and the chat folds each one into a single line.
- **Guardrails:** `app.config.yaml` `schedules:` sets `minIntervalMinutes` (60), `maxRunsPerUserPerDay` (24), `runStepBudget` (8), `runTokenBudget` (20000) and `defaultModel`. That's the model for ordinary chats; by default the `fast` alias. `GET /api/schedule-limits` shows them along with today's usage.
- **Archiving** a chat pauses its schedules, and deleting it deletes them.
- **UI:** the `/schedules` page (filters, search, run history, editor), the chat header's "Next run" button or clock, the Dot profile's Scheduled tab, the palette's "Open scheduled tasks", ⌘⇧D for your Dot, and the Proposed schedule card for the Dot's `schedule_task` call.

## Not yet

- Notification policy (all, failures only, none) and push/email: unread state
  only for now (the Collaboration wave owns notifications).
- One destination: the Dot's own conversation.
- A Dot profile page with Scheduled / Activity / Rules tabs; today it's the
  list row, the dialog and the chat's schedule header.
- `nextRunAt` granularity is one minute (the tick).
