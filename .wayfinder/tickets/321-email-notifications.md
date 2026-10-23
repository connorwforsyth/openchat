---
id: "321"
title: "Email phase 2: notifications, digests and one-click unsubscribe (stub)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["320"]
---

## Question

Stub: specify fully when 320 closes. In-app stays the system of record and
email is a delayed fallback for unread items (Dot runs that need
attention, failures, accepted invites, later mentions and shares).
Research: [`.context/research/email`](../../.context/research/email/README.md),
"Phase 2: notifications and digests".

## Done when (outline)

- `notification`, `notification_pref` and `notification_delivery` tables; a
  pure `routeNotification(kind, prefs, presence)` beside `shouldNotify`.
- Email only if still unread after `fallbackDelayMinutes`; a daily digest
  cron; per-user daily caps.
- RFC 8058 one-click unsubscribe (Hono POST with no session, GET confirm)
  with an HMAC token; transactional mail ignores preferences.
- Per-category channel preferences in full-screen Settings.
- Contract PR for `notifications.*`; a port PR only if digests need pg-boss
  throttling.

## Owns

To be set when specified.
