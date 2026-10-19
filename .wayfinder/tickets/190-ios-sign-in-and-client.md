---
id: "190"
title: "Sign in on iOS and call the API with the generated client"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["184", "188"]
---

## Question

The approach [Swift client research](184-swift-client-stack.md) recommends: generated client, bearer sign-in via `ASWebAuthenticationSession`, token in Keychain, sign-out wipes token and cache.

## Done when

- Email and each configured social provider sign in against a local dev server; a signed-in call (`me` or the chat list) succeeds; sign-out returns to sign-in.
- An expired or revoked token lands back on sign-in, never a crash.
- Tests use a mocked transport; no network in tests.

## Owns

`apps/ios/**/API/**`, `apps/ios/**/Auth/**`, the client generator config.
