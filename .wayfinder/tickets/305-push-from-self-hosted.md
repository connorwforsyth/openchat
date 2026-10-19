---
id: "305"
title: "How does a self-hosted instance send APNs and web push with OSS only?"
labels: [wayfinder:research]
status: closed
map: "300"
assignee:
blockedBy: []
---

## Question

The instance holds an APNs token key (`.p8`, key id, team id) in `.env`; no key means push is off. Find: the OSS Node library for APNs over HTTP/2 with token auth (or plain `node:http2` + JWT, and how small that is), sandbox vs production endpoints, payload limits, collapse ids, `mutable-content` for rich notifications, notification actions (approve/deny from the lock screen: what the app must do), Live Activity push tokens for later. Same for web push (VAPID, `web-push`, Safari support). Propose the data the server must store (device registrations per user and instance, platform, environment, token, revocation on 410) and the events that send (run settled, awaiting approval), as input to a contract ticket. Cite `.context/research/t3code/remote-mobile.md` §3.7.

Findings: `.context/research/ios/push.md`.

## Resolution (2026-10-20, research agent)

**APNs:** our own small sender on `node:http2` + `node:crypto` (about 120 lines, no dependency; fallback `@parse/node-apn`). Token refresh every 20–60 min, 4 KB payloads, `apns-collapse-id` per run, a 410 deletes a device only if the device registered before the reported timestamp. **Web push:** `web-push` (MPL-2.0); 404/410 means a dead subscription; on iPhone only for Home Screen web apps (16.4+). **Privacy:** payloads carry ids and generic text only; a Notification Service Extension (iOS) or the service worker (web) fetches the title from the instance, so the sign-in token sits in a **Keychain access group shared with the extension, readable after first unlock**. **Lock-screen approve/deny** only when exactly one tool call is pending and it proposes no file edits; otherwise tapping opens the app. **Data:** a `push_device` table, unique on (platform, token), deleted when its session is revoked; routes under `/me/push-devices` plus a test-send; preferences in the existing user settings; public config gains `push` and capabilities `push.apns`/`push.web`. **Server:** an `onAwaitingApproval` executor hook; sending is a `notify.run` job, enqueued where runs already enqueue follow-up jobs. **Env:** `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_KEY_PATH` or `APNS_KEY`; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; app id from `brand.appId`. None set means push is off; a partial set turns that transport off with one warning at boot. **Tests:** MSW can't see `node:http2`, so APNs gets a fake transport plus one local HTTP/2 server test. Detail: `.context/research/ios/push.md`.
