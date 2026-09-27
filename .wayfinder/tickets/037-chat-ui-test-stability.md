---
id: "037"
title: "Stabilise chat-ui approval tests on CI"
labels: [wayfinder:build]
status: closed
assignee:
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

## Resolution (2026-09-27, loop)

Merged in [PR #26](https://github.com/connorwforsyth/openchat/pull/26): chat-ui tests mock the lazy module with a synchronous one (`sync-lazy.tsx`, a `TestDiffView` stand-in driven by code-ui's real review logic), preload heavy chunks in `beforeAll`, forbid workers in unit tests, and keep one real lazy-path test. 5/5 runs under load; local gate 73/73.
