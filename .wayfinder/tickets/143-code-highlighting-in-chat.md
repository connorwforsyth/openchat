---
id: "143"
title: "Code blocks in chat are syntax-highlighted, incrementally while streaming"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/web.md`, recommendation 1). Code fences in replies render as plain text: `packages/ui/src/components/ai-elements/` notes "Streamdown renders fences without highlighting" and no code plugin is installed. T3 highlights with Shiki, re-tokenising only the new tail while streaming (`t3:apps/web/src/lib/incrementalHighlighting.ts`), forces the Oniguruma WASM engine because the JS regex engine can hang on hostile input (`t3:apps/web/src/lib/syntaxHighlighting.ts`), caches finished blocks in an LRU, and keeps a block's height but hides it until coloured so plain text never flashes (`t3:apps/web/src/components/ChatMarkdown.tsx` ~1086–1180).

## Done when

- Fenced code in assistant messages is highlighted with the theme's light/dark code colours (tokens only; no literals outside `globals.css`). Prefer Streamdown's official code plugin (`@streamdown/code`) or the Shiki already in the tree via `@pierre/diffs`; don't add a second highlighter if one is already bundled.
- The highlighter loads lazily (not on the composer-first boot path, D27), with the WASM engine, one cached highlighter per language, and `text` as the fallback for unknown languages.
- While streaming, highlighting doesn't redo the whole block per chunk (incremental or throttled to completed lines); finished blocks are cached (LRU keyed on code, language, theme).
- No flash of unstyled code at the swap; any appearance is opacity only, per the motion rules.
- Copy and download buttons still work. Browser test: a streamed fence ends highlighted; an unknown language renders as text; a 2,000-line block stays responsive.
- Gate and e2e pass.

## Owns

`packages/chat-ui/src/conversation/markdown.tsx` and new files beside it, `packages/chat-ui/package.json`, `packages/ui/src/components/ai-elements/code-block.tsx` (if used), `packages/ui/src/styles/globals.css` (code colour tokens only), tests.
