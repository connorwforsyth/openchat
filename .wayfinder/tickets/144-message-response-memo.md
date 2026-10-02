---
id: "144"
title: "A reply's markdown controls stay in their streaming state after the stream ends"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found by the T3 Code study (`.context/research/t3code/web.md`, recommendation 2). `MessageResponse` (`packages/ui/src/components/ai-elements/message.tsx`) is memoised on `children` alone. Streamdown reads `isAnimating` to switch its controls (code copy, table and mermaid actions) out of their streaming state; when a stream ends, the last render usually has the same text, so `isAnimating=false` is swallowed and the controls stay in the streaming state until something remounts the message.

## Done when

- The comparator also compares `isAnimating`, `mode` and `plugins` (identity), so the end of a stream re-renders once.
- A browser test finishes a stream with unchanged text and checks the controls leave the streaming state.
- Gate passes.

## Owns

`packages/ui/src/components/ai-elements/message.tsx` and a test beside it.
