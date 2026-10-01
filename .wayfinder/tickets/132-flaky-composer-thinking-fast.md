---
id: "132"
title: "Flaky e2e: composer.spec 'the thinking level and fast mode sit apart' (105)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

`e2e/tests/composer.spec.ts:188` fails intermittently under load. It failed on 116's agent run, once on 129 and once on 106, and passed on reruns (129: three full runs, 74/74 each). The failures are `toHaveAccessibleName` on the Thinking button and `toBeVisible` on the Fast mode chip. A likely cause is a race where the new chat's details or the model list settle after the user picks a level or model, and reset it. That would be a real UI bug (cf. 111), not just a slow test.

## Done when

- Root cause found by instrumenting the failing run (trace on failure). Fix the app if it's a reset race; otherwise fix the test's waits.
- The spec passes in 20 repeats under parallel load (`--repeat-each`).

## Also (2026-10-02)

`@workspace/chat-ui#test` failed in the gate under heavy load on 106 (3 runs) and on 124 (once), then passed alone and on clean runs (395/395). Find which test it is when fixing this one.
