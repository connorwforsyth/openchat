---
id: "156"
title: "Desktop: a transparent title-bar overlay on Windows and Linux, and a traffic-light inset that survives zoom"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/desktop.md` §3.4–3.5). 117's open item: the Windows and Linux custom bar needs theme colours in main. T3 sidesteps that with `titleBarStyle: "hidden"` and a transparent `titleBarOverlay` (`#01000000`, because `#00000000` breaks on Linux), syncing only `symbolColor` from `nativeTheme` (`t3:apps/desktop/src/window/DesktopWindow.ts` ~254–275). Separately, the macOS traffic-light inset is a fixed 80 px, so after ⌘+/⌘− the header's reserved space no longer matches the lights; T3 publishes `--desktop-window-controls-inset` as `90 / webFrame.getZoomFactor()` from the preload on load and resize (`t3:apps/desktop/src/preload.ts` 33–44).

## Done when

- Windows and Linux windows use the transparent overlay with `symbolColor` following `nativeTheme`; the literal carries a `ci-guard-ignore tokens:` comment saying why.
- The instance preload publishes the inset variable, divided by the zoom factor, on load and on resize; chat-ui's header reads it with 80 px as the fallback.
- Desktop e2e: after zooming in, the inset variable shrinks accordingly (macOS). Windows/Linux are checked by a unit test of the window options (no hardware here; say so).
- Gate and `test:desktop` pass.

## Owns

`apps/desktop/src/main/window*.ts`, `apps/desktop/src/preload/instance.ts`, the header inset in `packages/chat-ui/src/**` (one CSS variable read), tests.
