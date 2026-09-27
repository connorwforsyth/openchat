---
id: "046"
title: "Pre-demo audit: the §11 M1 checks e2e doesn't cover"
labels: [wayfinder:task]
status: open
assignee: loop
blockedBy: []
---

## Question

The e2e suite (23 tests) covers `PLAN.md` §11 M1 steps 1–5, 7, 8 and 10, and the just-bash half of 6.
Before Connor's demo (026), do the remaining §11 checks pass?

1. **Docker sandbox (step 6):** with `--profile sandbox`, an agent (mock model) runs `npm create vite` and a dev
   server, and the preview loads. `web` has no Docker socket mounted, and `sandbox-runner` reports `runsc` or the warning.
2. **Config:** an invalid `app.config.yaml` fails at boot with a readable error.
3. **Brand:** changing `brand.name` renames the app everywhere (UI title, emails/strings, metadata). The CI brand check catches a stray `openchat` literal.
4. **Icons:** switching `icons.set` to `material` and rebuilding changes the icons in shadcn primitives, AI Elements, the file tree and Markdown. CI lists unmapped icons.
5. **Contract:** `/openapi.json` from the running app passes Redocly lint.
6. **i18n:** `lingui extract` reports zero missing keys.

## Done when

Each check above has a recorded result (pass, or a fix merged, or a follow-up ticket for anything bigger than an hour).
Checks that can be automated cheaply become tests or guards. The Resolution lists what Connor can skip in the demo.

## Owns

Anything except `packages/contract` (contract changes go to Connor). Keep fixes small.
