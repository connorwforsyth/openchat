---
id: "037"
title: "Stabilise chat-ui approval tests on CI"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

`conversation-view.test.tsx` "approvals" tests (per-hunk review, reject with reason) time out at
30 s on loaded CI runners: they wait on the lazily loaded `DiffView` (+ Shiki worker pool). Make
them deterministic: in tests, provide the lazy module synchronously (e.g. a test-only
`DiffView` stub via a module mock or a provider prop) and don't start the Shiki worker pool; keep
one real integration test of the lazy path with generous timeouts, isolated in its own file.

## Owns

`packages/chat-ui/src/**/*.test.tsx`, test utilities in `packages/chat-ui`.

## Done when

`bun turbo test --filter @workspace/chat-ui` passes 5 times in a row locally under load
(`--concurrency` high) and CI passes.
