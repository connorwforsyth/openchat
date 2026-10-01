---
id: "116"
title: "Desktop shell: an electron-vite app that runs the chat against a server"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

The first usable desktop app: the same chat, settings and library as the web, in a native window, against an instance the person signs in to. No cowork yet.

## Done when

- `apps/desktop` (electron-vite: main, preload, renderer). The renderer is a Vite React app sharing `packages/{ui,chat-ui,composer,client,shortcuts,i18n}` as PLAN says (a second shadcn app). Any app glue that lives only in `apps/web` (chat route, app frame) is first moved into a shared package so both apps use it, with web unchanged.
- **Server:** instance URL only (Connor, 2026-10-02). The person enters it on first run; it's remembered and switchable. macOS first. Sign-in through the system browser with PKCE (`@better-auth/electron`); no passwords typed into the app.
- **Security (D24):** `contextIsolation`, no `nodeIntegration`, a strict preload with zod-parsed IPC, and navigation and new windows locked to the instance and the artifacts origin.
- Streaming and resume work (the run stream over fetch). Lingui works.
- Playwright `_electron.launch` smoke test: launch, sign in against the e2e server, send, get a reply. Gate passes; `bun run desktop:dev` documented.

## Owns

`apps/desktop/**` (new), shared app-glue moves out of `apps/web` (web unchanged), `e2e/desktop/**`.
