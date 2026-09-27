---
id: "024"
title: "WS-shell: palette, shortcuts, settings and admin"
labels: [wayfinder:build]
status: closed
assignee:
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

## Resolution (2026-09-27, loop)

Merged in [PR #20](https://github.com/connorwforsyth/openchat/pull/20): `packages/shortcuts` (typed registry, ⌘/Ctrl display, editable-safe single keys, user overrides, TanStack Hotkeys behind our hooks, `Kbd`, `?` dialog, `electronAccelerator()`), `packages/palette` (⌘K: cached chats instantly then merged server hits, actions, library, settings, Ask AI, context actions), settings pages (profile/language, keys, memory, shortcuts, appearance), admin pages (policies within config limits, members/invites, team tree, keys, budgets/usage, audit toggle), and the social-provider config fix (Q17). Verified: 70/70 turbo tasks; empty-env pages 200; CI passed (after fixing a timing-sensitive palette test).
