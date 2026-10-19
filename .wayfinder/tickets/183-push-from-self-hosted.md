---
id: "183"
title: "How does a self-hosted instance send APNs and web push with OSS only?"
labels: [wayfinder:research]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

The instance holds an APNs token key (`.p8`, key id, team id) in `.env`; no key means push is off. Find: the OSS Node library for APNs over HTTP/2 with token auth (or plain `node:http2` + JWT, and how small that is), sandbox vs production endpoints, payload limits, collapse ids, `mutable-content` for rich notifications, notification actions (approve/deny from the lock screen: what the app must do), Live Activity push tokens for later. Same for web push (VAPID, `web-push`, Safari support). Propose the data the server must store (device registrations per user and instance, platform, environment, token, revocation on 410) and the events that send (run settled, awaiting approval), as input to a contract ticket. Cite `.context/research/t3code/remote-mobile.md` §7.

Findings: `.context/research/ios/push.md` on branch `research/ios-push`.
