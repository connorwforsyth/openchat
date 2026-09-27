---
id: "040"
title: "Integration: Docker, compose and end-to-end"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["038","039"]
---

## Question

Split from 025. A production `apps/web` Dockerfile (Next standalone on Node 24), `docker compose up` bringing up web + postgres (+ optional searxng, artifacts, sandbox profiles) with migrations on start; Playwright e2e covering every `PLAN.md` §11 M1 step that doesn't need a human (sign-up/invite, org + team tree, chat with streaming + resume after reload, branching, search, context lock + key payer, sharing/publishing checks, just-bash sandbox, per-hunk review, memory + undo, i18n extract, title + PDF search jobs) plus TTFB / `composer:ready` / first-token timings; a CI `e2e` job running them against the compose stack.

## Owns

`apps/web/Dockerfile`, `docker-compose.yml`, `e2e/`, `.github/workflows/ci.yml` (e2e job), `playwright.config.ts`.

## Done when

`docker compose up` → working app on localhost; `bun turbo test:e2e` green locally and in CI.
