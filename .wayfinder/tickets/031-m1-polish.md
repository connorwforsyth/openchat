---
id: "031"
title: "M1 polish: motion audit, narrow screens, batched feedback"
labels: [wayfinder:build]
status: open
assignee: loop
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
