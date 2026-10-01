---
id: "135"
title: "Quick AI: a native-feeling strip (input + button, translucent, no hints, no scrollbar)"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02), after trying 118: "I'd rather the quick AI look and feel a little bit more native - i.e. just a strip the input and a button - maybe with some transparency - and the keyboard shortcuts not being below - there's also a scrollbar to the quick composer which is a big no no."

## Done when

- **Idle:** Quick AI is a single strip with just the text input and a send button. No toolbar, no + menu, no model picker and no shortcut hints underneath.
- **Look:** the macOS window is translucent (native vibrancy, e.g. `vibrancy: "hud"`/`"popover"` with a transparent page background), with rounded corners and a native shadow. It looks right in light and dark.
- **No scrollbar:** none in the input or anywhere in the window, at any height. A long input grows to a cap and then scrolls without a visible bar.
- **Reply:** the reply area appears below the strip only once there's a reply, keeping the same native look and without a visible scrollbar.
- **Raycast ⌘K style** (Connor, 2026-10-02: "it should be a little bit like raycast command k style"):
  - a wide, fairly tall single input row with large text (about 18–20px), a placeholder like "Ask anything…" and a small icon at its start;
  - a hairline divider under the input once there's something below it;
  - a compact, muted footer bar only while a reply shows, with the action hint on the right ("Open in the app ⌘↵"); no hint rows otherwise;
  - the reply in a list-like panel below with comfortable padding and no visible scrollbar;
  - translucent vibrancy, about a 12px corner radius, a soft shadow, a fixed width of about 680–750px, centred slightly above the middle of the screen.
- Escape, ⌘⏎ and the global shortcut still work. Desktop smoke and the `/quick` e2e are updated, and screenshots are checked by eye.
