# Dots: always-on scheduled agents

A **Dot** is a persistent agent: a model plus instructions, or a published
library agent (which brings its own tools, MCP servers and skills). Each Dot
has its own conversation, its own workspace (sandbox) and one or more cron
schedules. Every run, scheduled or "Run now", posts the schedule's prompt into
the Dot's conversation and answers it there. The `/dots` page shows each Dot's
status, next run, last result and an unread marker.

Ticket 172. Contract changes are in their own branch (`t/172a-contract-dots`).

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
   createRun(as owner, idempotencyKey "dot:s:<schedule>:<occurrence>")
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
- **Unattended policy** (`packages/server/src/dots/policy.ts`,
  `unattendedApproval`): on a Dot's run, a tool that would ask for approval
  is withheld and a call to it is answered with a clear tool error, unless the
  Dot lists the tool in `autoApproveTools`. A Dot's run never pauses for an
  approval. Manual chat in the Dot's conversation keeps normal approvals; the
  policy keys off the run's `dot:` idempotency key.
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

## Not yet

- Notification policy (all, failures only, none) and push/email: unread state
  only for now (the Collaboration wave owns notifications).
- One destination: the Dot's own conversation.
- A Dot profile page with Scheduled / Activity / Rules tabs; today it's the
  list row, the dialog and the chat's schedule header.
- `nextRunAt` granularity is one minute (the tick).
