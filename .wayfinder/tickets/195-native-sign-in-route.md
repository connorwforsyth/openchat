---
id: "195"
title: "Social and OIDC sign-in hand a native app a one-time token, never a session in a URL"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

From [Swift client research](184-swift-client-stack.md): a custom-scheme callback is refused today, and the Expo plugin's pattern puts the session token in the redirect URL. Add Better Auth's `oneTimeToken()` plugin and a small `/auth/native` route: the app opens it in `ASWebAuthenticationSession`, the person signs in with any configured provider, and the redirect to the app's scheme carries only a 3-minute single-use token, which the app exchanges for a bearer token.

## Done when

- The app scheme comes from `brand:` config and is the only extra allowed callback; other schemes are refused.
- Exchange is single-use and expires; a replayed or expired token fails with a typed error.
- Tested in-process through `app.request()`, with an email flow and a mocked social provider; nothing changes for web sign-in.

## Owns

`packages/auth/src/**` (plugin config, the native route), its tests.
