---
id: "016"
title: "WS-composer: the prompt composer"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["008"]
---

## Question

A standalone, reusable composer: attachments, model/agent picker, context chip, `/` prompt
templates, and mentions (`PLAN.md` §6, D13).

## Owns

`packages/composer`.

## Done when

Component tests; usable in isolation with only `@workspace/ui` and the contract types.

## Resolution (2026-09-27, loop)

Merged in [PR #9](https://github.com/connorwforsyth/openchat/pull/9), redirected mid-build to TipTap by Connor (D27): `packages/composer` on TipTap (MIT only) with `/` templates + `{{variables}}`, `@` mentions, attachments, model/agent picker, context chip, stop; a server-rendered `ComposerShell` hands over to the lazily loaded editor with no layout shift and marks `composer:ready` (~430 ms). The loop fixed `globals.css` `@source` globs so every package gets its Tailwind utilities, and CI now installs headless Chromium for browser-mode tests. Verified: 47/47 turbo tasks, 65 browser tests, `/dev/composer` 200, CI passed. Follow-up: a Base UI popover for the suggestion menu (the menu is a custom listbox for now).
