---
id: "031"
title: "M1 polish: motion audit, narrow screens, batched feedback"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["015"]
---

## Question

Follow-ups from 015: bring the existing `packages/ui` components (tooltip, dropdown, tool,
reasoning) in line with D28 motion rules (transform/opacity only, instant in, ~150 ms fade out, no
height animation); a narrow-screen layout (sidebar as a sheet, right panel as a sheet); fetch
feedback for a whole branch in one request instead of one query per message (additive query +
client hook, no contract change if an existing procedure fits; otherwise report).

## Owns

`packages/ui` (motion only), `packages/chat-ui` (responsive layout, feedback hook).

## Done when

No height/width animations remain in shared components; `/dev/chat` works at 375 px; one feedback
request per branch view.

## Resolution (2026-09-27, loop)

Merged in [PR #24](https://github.com/connorwforsyth/openchat/pull/24): D28 motion audit across `packages/ui` (instant in, token fade out, no height/`transition-all`; switch and toggle fixed at merge), a motion guard in `scripts/ci`, narrow-screen shell (sidebar and panel as sheets, condensed header, `dvh`, safe-area composer), `useBranchFeedback` batching lookups. Verified: 73/73 turbo tasks; `/dev/chat` at 375×812 and desktop; CI passed. Open: true one-request feedback via oRPC batching (025).
