---
id: "300"
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
each. Its tickets live in `tickets/` with `map: "300"` in their front matter.

**What the app is** was settled while charting; the detail lives in
[What the iOS app is, and how it's built](tickets/301-charting-decisions.md).
Ticket references are by name; ids here start at 300 to stay clear of the
main map's.

**Skills:** `write-swift` for all Swift; `apple-design` and `emil-design-eng`
for the chat surface; `grilling` for HITL tickets; `prototype` for the
prototype ticket. Server-side work follows the main map's standing constraints.

## Decisions so far

<!-- one line per closed ticket -->

- [What the iOS app is, and how it's built](tickets/301-charting-decisions.md): SwiftUI replaces Expo; stock chrome, bespoke chat surface; generated client; push from the instance; v1 scope
- [Does a web run really carry on when the tab is closed?](tickets/303-web-run-survives-closed-tab.md): yes; nothing notifies, and approvals wait forever
- [Which native renderer draws streaming markdown?](tickets/304-swiftui-streaming-markdown.md): MarkdownView 3.x behind our own wrapper; race SwiftStreamingMarkdown in the prototype
- [How does an Xcode project live in the monorepo?](tickets/307-xcode-in-the-monorepo.md): XcodeGen + local Swift packages, one simulator per worktree; Xcode isn't installed yet
- [How does a self-hosted instance send push?](tickets/305-push-from-self-hosted.md): a small `node:http2` APNs sender and `web-push`, with content-free payloads
- [Does the generated Swift client work against our server?](tickets/306-swift-client-stack.md): yes, after a preprocessing script and a native sign-in route

## Not yet specified

- **Chat list and contexts:** sidebar shape on iPhone vs iPad, search, the
  personal/org/team switcher, shared-with-me. Graduates after the prototype.
- **Chat screen:** streaming render, tool lines, approval cards, the
  model/agent picker, resuming on foreground (stream chunks are pruned 600 s
  after a run settles, so a late reopen falls back to the stored message).
  Hangs on the prototype.
- **Attachments:** photo picker, files, camera; upload path through the
  existing storage routes.
- **Artifacts:** read-only `WKWebView` hosting the artifacts runtime; how it's
  fed is in [the Swift client research](tickets/306-swift-client-stack.md).
- **Push on the phone:** registering the device, the notification service
  extension, tapping into the chat, and lock-screen actions, as
  [the push research](tickets/305-push-from-self-hosted.md) lays out.
- **Web push:** the browser side of the same notifications.
- **Local cache:** SwiftData model, invalidation from run events, sign-out wipe.
- **Demo gate:** the `PLAN.md` §11 checks for this wave, rewritten for Swift.

## Out of scope

- Android, and the Expo app.
- A push relay hosted by the publisher (that's running a service; see main map).
- On iOS in this effort: the agent, prompt, skill and MCP builders; admin; the
  workspace and sandbox; annotate. They stay on the web.
- An offline send queue, voice beyond system dictation (it follows
  [voice](tickets/104-voice-mode.md)), and Live Activities: later efforts.
