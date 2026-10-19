---
id: "312"
title: "Sign in on iOS and call the API with the generated client"
labels: [wayfinder:build]
status: open
map: "300"
assignee:
blockedBy: ["310", "317"]
---

## Question

The approach [Swift client research](306-swift-client-stack.md) recommends: the generated client behind its preprocessing script (nullables, `const` unions) and a millisecond date decoder; email sign-in by one cookie-less `POST`; social/OIDC through [the native sign-in route](317-native-sign-in-route.md); bearer sign-in via `ASWebAuthenticationSession`, token in the Keychain the way [the push research](305-push-from-self-hosted.md) requires (shared with the notification extension), sign-out wipes token and cache.

## Done when

- Email and each configured social provider sign in against a local dev server; a signed-in call (`me` or the chat list) succeeds; sign-out returns to sign-in.
- An expired or revoked token lands back on sign-in, never a crash.
- Unknown union members and enum values from a newer server decode to an `unknown` case rather than failing.
- Tests use a mocked transport; no network in tests.

## Owns

`apps/ios/**/API/**`, `apps/ios/**/Auth/**`, the client generator config and preprocessing script.
