---
id: "301"
title: "What the iOS app is, and how it's built"
labels: [wayfinder:grilling]
status: closed
map: "300"
assignee: connor
blockedBy: []
---

## Question

Charting the [iOS map](../ios-map.md): what is the app, what's in v1, and which approaches are fixed before any ticket starts?

## Resolution (2026-10-20, Connor)

- **Native SwiftUI replaces the Expo app** in the Mobile wave. Android is out of scope.
- **"Works when the app is closed"** means runs carry on on the server (they already do on web) and a push says when a run finished or needs an approval; tapping it opens the chat. Web gets the same through web push.
- **v1:** sign-in; the chat list with search across personal, org and team contexts, plus chats shared with you; a chat with streamed markdown, code and tool lines; the model/agent picker; approvals; photo and file attachments; push; artifacts read-only.
- **Talking to the server:** the existing contract through `swift-openapi-generator` over `/api/openapi.json`, an `AsyncSequence` SSE parser for run streams, Better Auth `bearer()` with `ASWebAuthenticationSession` and the Keychain. New endpoints go in their own contract PRs.
- **Look:** iOS 26 minimum. Stock where it's chrome (navigation, lists, sheets, settings, menus, Liquid Glass); bespoke where it's chat (the message column, composer, tool lines, approval cards, streaming text), the way the web layers its theme over shadcn. Light and dark are both first-class.
- **One theme source:** a script turns the semantic tokens in `packages/ui` `globals.css` into an asset catalog. Brand accent and font come from instance config at runtime.
- **One instance per app,** entered at first launch and switchable in Settings.
- **SwiftData** caches the chat list and recent chats for an instant open.
- **Push keys** live in the instance's `.env`; without them push is off and nothing else breaks. The app is built and signed with Connor's Apple Developer account.
- **Gate per ticket:** tests run locally in the worktree, with `swift-format` through lefthook. No iOS job in CI (macOS minutes on the free plan).
