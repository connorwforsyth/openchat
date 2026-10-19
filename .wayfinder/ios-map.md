---
id: "179"
title: "iOS — a native SwiftUI app alongside the web app"
labels: [wayfinder:map]
status: open
---

## Destination

`apps/ios`: a SwiftUI app Connor uses daily against his own instance. It signs
in, lists chats across personal, org and team contexts, streams replies, handles
approvals, takes photo and file attachments, and shows artifacts read-only. A
run carries on when the app is closed and a push says when it finished or needs
an approval (web gets the same through web push). The map ends at a demo gate
Connor runs on a real phone.

## Notes

**This map carries execution**, like [the main map](map.md): build tickets are
worked by the loop in [`LOOP.md`](LOOP.md), each in its own worktree, one PR
each. Its tickets live in `tickets/` with `map: "179"` in their front matter.

**Settled while charting (2026-10-20, Connor):**
- Native SwiftUI replaces the Expo app in the Mobile wave; Android is out of scope.
- Talks to the server through the existing contract: `swift-openapi-generator`
  over `/api/openapi.json`, a small `AsyncSequence` SSE parser for run streams,
  Better Auth `bearer()` + `ASWebAuthenticationSession` + Keychain. New endpoints
  (device registration, stream tickets) are their own contract PRs.
- iOS 26 minimum. **Stock where it's chrome, bespoke where it's chat:**
  navigation, lists, sheets, settings, menus stay stock SwiftUI and Liquid
  Glass; the message column, composer, tool lines, approval cards and streaming
  text get tasteful custom work, the way the web layers its theme over shadcn.
  Light and dark both first-class.
- Colours come from one source: a script turns `packages/ui` `globals.css`
  semantic tokens into an asset catalog. Brand accent and font come from
  instance config at runtime.
- One instance per app, entered at first launch, switchable in Settings.
- SwiftData caches the chat list and recent chats for an instant open; no
  offline send queue in v1.
- APNs key lives in the instance's `.env`; without it push is off and nothing
  else breaks. Built and signed with Connor's Apple Developer account.
- Gate per ticket: `xcodebuild test` locally in the worktree plus
  `swift-format` via lefthook. No iOS job in CI (macOS minutes on the free plan).
- Voice beyond system dictation waits for [voice](tickets/104-voice-mode.md).

**Skills:** `write-swift` for all Swift; `apple-design` and `emil-design-eng`
for the chat surface; `grilling` for HITL tickets; `prototype` for the
prototype ticket. Server-side work follows the main map's standing constraints.

## Decisions so far

<!-- one line per closed ticket -->

## Not yet specified

- **Chat list and contexts:** sidebar shape on iPhone vs iPad, search, the
  personal/org/team switcher, shared-with-me. Graduates after the prototype.
- **Chat screen:** streaming render, tool lines, approval cards, the
  model/agent picker, resume from cursor on foreground. Hangs on the markdown
  research and the prototype.
- **Attachments:** photo picker, files, camera; upload path through the
  existing storage routes.
- **Artifacts:** read-only `WKWebView` of the artifacts origin; needs stream or
  view tickets so no bearer token rides in a URL.
- **Push on the phone:** registering the device, tapping into the chat,
  notification actions (approve from the lock screen?), later Live Activities.
- **Web push:** the browser side of the same notifications.
- **Local cache:** SwiftData model, invalidation from run events, sign-out wipe.
- **Demo gate:** the `PLAN.md` §11 checks for this wave, rewritten for Swift.

## Out of scope

- Android, and the Expo app.
- A push relay hosted by the publisher (that's running a service; see main map).
