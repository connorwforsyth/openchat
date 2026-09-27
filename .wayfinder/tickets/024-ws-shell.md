---
id: "024"
title: "WS-shell: palette, shortcuts, settings and admin"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["012","009"]
---

## Question

The ⌘K palette, the shortcut registry (`packages/shortcuts`, TanStack Hotkeys, user-recorded
shortcuts), the settings pages (keys, memory, language, shortcuts), and the admin UI (org
policies within config limits, keys, budgets, audit), following 009's direction
(`PLAN.md` D10, D14, D17, D18).

Speed (D28): ⌘K searches the cached conversations, library items and actions instantly, then merges server full-text results.

## Owns

`packages/shortcuts`, settings and admin routes in `apps/web`.

## Done when

Component and route tests; shortcuts are listed in the `?` dialog; org policy changes
respect the `app.config.yaml` bounds.
