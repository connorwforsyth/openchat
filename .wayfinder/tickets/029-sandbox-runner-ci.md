---
id: "029"
title: "CI: smoke-test sandbox-runner against real Docker"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["019"]
---

## Question

019's Docker path was only tested against a fake (no daemon on the dev Mac). GitHub's Ubuntu
runners have Docker. Add a CI job that builds `apps/sandbox-runner`'s image, starts the `sandbox`
compose profile (runner + socket proxy), and runs `PLAN.md` §11 step 6 for Docker: create a
sandbox, `npm create vite` (or a tiny static server), start a dev server, and fetch the preview.
Also install gVisor (`runsc`) on the runner in a second matrix leg and assert the runner reports
`runsc`; the first leg asserts the `runc` warning.

## Owns

`.github/workflows/ci.yml` (new job), `apps/sandbox-runner/test/e2e/` (new), `docker-compose.yml`
fixes if the smoke test finds any.

## Done when

The job passes on both legs, and any fixes to the runner land with it.
