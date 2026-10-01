---
id: "115"
title: "Harness e2e: 'a reload mid-run or during a pause' is flaky"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

`e2e/tests/harness.spec.ts` "a reload mid-run or during a pause shows where the run is" failed 2 of 3 full runs (agent, 2026-10-01) and 2 of 33 when repeated (loop). After the reload, approving `script.js` doesn't land within 30s. It flakes on main too, not only on the branch being tested.

## Done when

- The cause is found: a timing race in the test, or a real product race in approvals across a reload (more serious, since it's what a person does).
- The cause is fixed, and the spec passes 50/50 repeated. The full suite is green.

## Owns

`e2e/tests/harness.spec.ts`, and `packages/server/src/runs/**` / `packages/chat-ui/src/**` if it's a product race.
