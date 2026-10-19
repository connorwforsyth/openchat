---
id: "190"
title: "Sign in on iOS and call the API with the generated client"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["188", "195"]
---

## Question

The approach [Swift client research](184-swift-client-stack.md) recommends: the generated client behind its preprocessing script (nullables, `const` unions) and a millisecond date decoder; email sign-in by one cookie-less `POST`; social/OIDC through [the native sign-in route](195-native-sign-in-route.md); bearer sign-in via `ASWebAuthenticationSession`, token in a Keychain access group shared with the notification extension (after-first-unlock; [push research](183-push-from-self-hosted.md)), sign-out wipes token and cache.

## Done when

- Email and each configured social provider sign in against a local dev server; a signed-in call (`me` or the chat list) succeeds; sign-out returns to sign-in.
- An expired or revoked token lands back on sign-in, never a crash.
- Tests use a mocked transport; no network in tests.

## Owns

`apps/ios/**/API/**`, `apps/ios/**/Auth/**`, the client generator config and preprocessing script.
