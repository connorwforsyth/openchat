---
id: "002"
title: "Scaffold the monorepo"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Create the Phase 0 skeleton everything else builds on (`PLAN.md` §10 Phase 0, steps 2–3; D5, D6, D8, D9).

- `bunx shadcn@latest init -t next --monorepo --base base` using the **default preset**
  (Connor re-themes later with `shadcn apply <preset>`). Convert `pnpm-workspace.yaml`
  to `package.json` `workspaces`, and pin React 19.2.x through the bun `catalog`.
- Turborepo tasks: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `eval`, `db:*`
  (stubs are fine where there's nothing to run yet).
- `packages/typescript-config`; Ultracite (Biome) + lefthook pre-commit.
- A Vitest workspace, plus Playwright configured (no tests yet).
- GitHub Actions CI running `bun install --frozen-lockfile` and `bun turbo typecheck lint test build`,
  with a job named `ci` so the branch protection on `main` can require it.
- `docker-compose.yml`: Postgres 17 + pgvector (optional `searxng` profile).
- `apps/web` boots (`bun dev`) with an empty `.env` and shows the shadcn starter page.

## Owns

Repo-root config (`package.json`, `turbo.json`, `biome.json`, `lefthook.yml`,
`vitest.workspace.ts`, `playwright.config.ts`, `.gitignore`), `.github/`,
`docker-compose.yml`, `apps/web`, `packages/ui`, `packages/typescript-config`.

## Done when

- A clean clone runs `bun install && bun turbo typecheck lint test build` green.
- `apps/web` boots with an empty `.env`.
- The PR's CI job `ci` passes. (Branch protection and auto-merge aren't available on this
  private repo's free plan, checked 2026-09-26, so the loop itself is the merge gate: see `LOOP.md` step 1.)
