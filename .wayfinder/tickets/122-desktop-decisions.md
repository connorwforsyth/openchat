---
id: "122"
title: "Desktop: Connor's decisions before building"
labels: [wayfinder:grilling]
status: closed
assignee:
blockedBy: []
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

## Done when

Answers to:
1. **M1 sign-off (026):** is "keen to start desktop" the M1 sign-off?
2. **Server:** does the desktop app always connect to an instance URL (yours, self-hosted), or should it also be able to run its own local server (embedded database, fully offline)?
3. **Platforms first:** macOS only first, or macOS + Windows + Linux from the start?
4. **Signing:** macOS notarisation needs an Apple Developer account (USD 99/year) and Windows signing a certificate. Unsigned builds until then (they warn on first open)?
5. **Order:** shell (116) → chrome (117) → Quick AI (118) → packaging (119) → cowork (120)? Or cowork earlier?

## Owns

`.wayfinder/QUESTIONS-FOR-CONNOR.md`.

## Resolution (2026-10-02, Connor)

1. **M1:** signed off.
2. **Server:** instance URL only. No local server.
3. **Platforms:** macOS first. Windows and Linux follow, hopefully cheaply.
4. **Signing:** not now. Unsigned builds, and Gatekeeper's first-open warning is documented. A Developer ID (US$99/yr) comes when distributing widely; macOS auto-update needs it.
5. **Cowork mode (120):** parked, since Connor isn't sure it's needed. It's the sandbox idea on a local folder.

Order: 116 shell → 117 chrome → 118 Quick AI → 119 packaging (unsigned).
