---
id: "158"
title: "`bun dev` passes .env to the app (keys in .env.local were dropped by turbo)"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-03): "on local the AI gateway isn't connected". Bun loads the root `.env` and `.env.local` into `bun dev`, but turbo runs tasks in strict env mode, so only variables a task declares reach it; `dev` declares none, and `next dev` (which reads `.env` files only from `apps/web`) never saw `AI_GATEWAY_API_KEY`. The run failed with "Missing Authorization header". `bun run setup up` hands `.env` over explicitly, which is why that path worked.

## Done when

- The root `dev` script runs turbo in loose env mode (`dev` isn't cached, so strict filtering buys nothing there), and so does `desktop:dev`.
- Builds, tests and e2e keep strict mode (their caches depend on declared env).

## Owns

Root `package.json` (the `dev` and `desktop:dev` scripts).
