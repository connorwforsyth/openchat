---
id: "149"
title: "Desktop: updates are a visible state with menu items, and tested against a local feed"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["148"]
---

## Question

From the T3 Code study (`.context/research/t3code/desktop.md` §3.1–3.2). `apps/desktop/src/main/updates.ts` (45 lines) sets `autoDownload` and installs on quit with no UI, so nobody learns an update is waiting, and the update path was only verified by watching it fail (119). T3 has a pure update state machine (`t3:apps/desktop/src/updates/updateMachine.ts`: disabled, checking, available, downloading, downloaded, error) and a mock update server so check → download → install runs end to end with no GitHub (`t3:scripts/mock-update-server.ts`).

## Done when

- A discriminated-union `UpdateState` with a pure reducer in `src/shared`, unit-tested. Main drives it from electron-updater events.
- The app menu has "Check for Updates…" and, once downloaded, "Restart to Update" (strings localised the way the desktop's other menu strings are). Still gated by `DESKTOP_AUTO_UPDATE`; with it off, the items aren't shown.
- `DESKTOP_UPDATE_URL` (generic provider) points the updater at any feed. A script or test packages two versions, serves the newer one from a temp dir, and checks `update-available` and `update-downloaded` (install can only be proven on Linux until signing; say so).
- Gate and `test:desktop` pass.

## Owns

`apps/desktop/src/main/updates.ts`, `apps/desktop/src/main/menu*.ts`, `apps/desktop/src/shared/update-state.ts` (new), `apps/desktop/scripts/builder-config.ts`, `apps/desktop/scripts/smoke-packaged.ts`, tests.
