---
id: "000"
title: "openchat — a self-hosted, multi-user AI chat platform"
labels: [wayfinder:map]
status: open
---

## Destination

Everything in [`PLAN.md`](../PLAN.md) is built and verified. That means Milestone 1
(the ambitious web daily driver), then the Desktop, Collaboration & always-on,
Agents+, Annotate, Mobile & Swift, and open-source-readiness waves. Each one
passes its `PLAN.md` §11 checks at a demo gate that Connor runs.

## Notes

**This map carries execution.** Wayfinder's default is decisions only; this
effort overrides that. `PLAN.md` is the spec; the map indexes it and never
restates it. Build tickets are worked by the loop in [`LOOP.md`](LOOP.md), with
up to 3 agents in parallel, each in its own git worktree, one PR per ticket,
merged by the loop once CI passes. The repo is private on GitHub's free plan, so
there's no branch protection or auto-merge.

**Skills each session should consult:** `grilling` for every HITL ticket;
`prototype` for the UI prototype tickets; `shadcn` and `migrate-radix-to-base`
for UI; `vercel-react-best-practices` for anything in `apps/web`; `ultracite`
for lint and format. For anything in `apps/web`, read
`node_modules/next/dist/docs`: Next 16 is not the Next you know.

**Standing constraints** (from `PLAN.md` D8, D18, D19 and the design review):
- Zod-first types; `Result` errors; no classes outside adapters; no DI container.
- Semantic design tokens only; icons only via `@workspace/icons`; every
  user-facing string via Lingui macros.
- No `openchat` literal outside the brand block, the root `package.json`, image
  names, `PLAN.md` and this tracker. The config file is `app.config.yaml`.
- The app boots with an empty `.env`. Agent features work with no keys: tests use
  `MockLanguageModelV4`, and local runs use Ollama if it's present. Degrade, never crash.
- OSS only. Never spend money, create paid resources or print secrets.
- Private repo (`connorwforsyth/openchat`). Never push directly to `main`, never
  force-push, never commit `node_modules`, `.next`, `.turbo` or `.env*`.

**Ownership register.** Parallel tickets must not overlap on these paths. Each
open build ticket's **Owns** section is authoritative; this summarises it:

| Ticket | Owns |
|---|---|
| 002 scaffold | repo root config, `apps/web` skeleton, `packages/ui`, `packages/typescript-config`, `.github/`, `docker-compose.yml` |
| 003 risk checks | `docs/decisions/`, `.context/research/`, throwaway spikes under `spikes/` |
| 004 conventions | `AGENTS.md`, `CLAUDE.md`, `scripts/ci/`, lint config additions |
| 005 contracts | `packages/contract`, `packages/config`, `packages/shared`, port files in `packages/{ai,sandbox,server}/src/ports/` |
| 006 i18n + icons | `packages/i18n`, `packages/icons` |
| 007 AI Elements | `packages/ui/src/components/ai-elements/`, `.agents/skills/` or `.claude/skills/` for pierre |
| 011–025 | see each ticket |

**Tracker:** local-markdown (`.wayfinder/`). Frontier: `bun .wayfinder/frontier.ts`.
No `research` or `domain-modeling` skill is installed on this machine, so
research tickets are resolved by general-purpose sub-agents against a written
brief, and their findings land in `.context/research/`.

## Decisions so far

- [Design review of plan v1](tickets/001-design-review.md): 40 answers
  settling audience, scope (an ambitious web M1, then waves), runs, tenancy, sharing,
  config, icons, memory, evals and safety. The detail lives in `PLAN.md` §13.

## Built

<!-- one line per closed build ticket: what, where, how verified -->

- [Scaffold the monorepo](tickets/002-scaffold.md): bun + Turbo + shadcn (Base UI) monorepo, Ultracite, Vitest, Playwright config, CI, compose ([PR #1](https://github.com/connorwforsyth/openchat/pull/1))

## Not yet specified

These waves are in scope. Each one graduates into tickets when the gate before it
closes (the M1 demo gate first). Their contents are in `PLAN.md` §2.

- **Desktop:** electron-vite app, cowork mode with a local agent loop and
  permission modes, Quick AI, title bar, native menus, packaging. Open
  questions to expect: how the local loop syncs runs, and the git-checkpoint UX.
- **Collaboration and always-on:** live multi-user chats, `apps/worker`,
  schedules, notifications.
- **Agents+:** test sets and eval runs, publish gates, sampled scoring,
  per-agent memory, the Jev adapter.
- **Annotate:** the annotate-to-agent loop on artifacts and previews.
- **Mobile and Swift:** the Expo app and the Swift spike.
- **Open-source readiness:** licence, brand, docs site, landing page,
  pseudo-locale and RTL gates, SAML, Helm.

## Out of scope

- Billing and payments (usage and budgets are in scope; charging money isn't).
- Running openchat as a hosted SaaS.
