---
id: "039"
title: "Integration: web app pages"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Split from 025 (read its full wiring list). Build the real app in `apps/web`: auth pages (sign in, sign up for the first user, accept invite, OIDC/social buttons from public config); the `(app)` layout using chat-ui's `AppShell` with the sidebar fed by TanStack Query (persisted to IndexedDB per D28, cleared on sign-out), header, right panel; chat routes (`/`, `/c/[id]`) mounting `ConnectedChat` with attachments upload; library, settings and admin pages moved inside the shell; ⌘K palette + shortcuts wired globally with their real actions; fix 024's `_shared/routes.ts`; `ARTIFACTS_ORIGIN` → chat-ui `runtimeOrigin` (030); `requestLocale` reads `user.locale`; viewport `interactive-widget=resizes-content`; inline script restoring theme + sidebar width/collapsed before paint; gate `/dev/*` behind `ENABLE_DEV_ROUTES`; composer-first boot (D27: only the chat route preloaded, everything else deferred until `composer:ready`).

## Owns

`apps/web` (app routes, layouts, auth pages), small props-only additions in `packages/chat-ui` if needed.

## Done when

With a running server (038's app on PGlite), a browser can sign up, chat with a mock/Ollama model, branch, search, open the library and settings, and use ⌘K; Lighthouse-style check: the chat route's initial JS excludes code-ui, KaTeX, library-ui and admin.

## Resolution (2026-09-27, loop)

Merged in [PR #30](https://github.com/connorwforsyth/openchat/pull/30): auth pages (sign-in, sign-up modes, invite), `proxy.ts` protection, the `(app)` shell around chat/library/settings/admin, persisted query cache (cleared on sign-out), pre-paint sidebar restore, palette after `composer:ready`, chat routes with attachments and the artifact runtime origin, locale from `user.locale`, `/dev/*` gated. Verified: 77/77; empty-env `/sign-in` 200, `/` → sign-in, `/dev/chat` 404; chat route first load 754 kB gzip with none of code-ui/KaTeX/library-ui/admin/palette/TipTap.
