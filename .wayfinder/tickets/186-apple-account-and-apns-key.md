---
id: "186"
title: "Connor sets up the bundle id, signing and an APNs key"
labels: [wayfinder:task]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

HITL checklist for Connor (no secret goes in the repo, a ticket or a PR):

1. Confirm the Apple Developer account and team id.
2. Register the app id (the bundle id comes from the `brand:` block; propose one) with Push Notifications on.
3. Create an APNs auth key (`.p8`); note the key id. Keep the file outside the repo.
4. Put `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_KEY_PATH` (names to confirm with [push research](183-push-from-self-hosted.md)) in your instance's `.env` only.
5. Register your iPhone for development.

Resolution records the bundle id, team id and where the key lives, never its contents.
