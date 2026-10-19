---
id: "182"
title: "Which native renderer draws streaming markdown and code in SwiftUI?"
labels: [wayfinder:research]
status: closed
map: "179"
assignee:
blockedBy: []
---

## Question

Replies stream as AI SDK UI message parts (text deltas, reasoning, tool parts). Compare OSS options for rendering markdown natively on iOS 26 while it streams: `AttributedString(markdown:)`, Apple's `swift-markdown` + own views, Textual (gonzalezreal's MarkdownUI successor), others current in 2026. Criteria: incremental updates without re-layout jank on long replies, code blocks with syntax highlighting (which highlighter, licence), tables, math if cheap, text selection and copy, dark/light theming from our tokens, Dynamic Type. Recommend one, with a sketch of how deltas feed it.

Findings: `.context/research/ios/streaming-markdown.md` on branch `research/ios-streaming-markdown`.

## Resolution (2026-10-20, research agent)

**MarkdownView 3.x** (LiYanan2004, MIT), wrapped in our own `MessageMarkdown` view so it can be swapped. It's the only mature option with streaming built in (background parse, reuses finished blocks, redraws at most every 50 ms), plus GitHub-flavoured markdown, Highlightr code (MIT / highlight.js BSD-3), SwiftMath and inline text selection. Runner-up: Microsoft's SwiftStreamingMarkdown (v0.7, repairs half-finished markdown mid-stream). Prototype 187 should race the two on one long reply. Textual is one to watch (re-parses every token #47, iOS 26 selection crash #87). Ruled out: MarkdownUI (maintenance mode), `AttributedString(markdown:)`, hand-built swift-markdown. **Pipeline:** SSE → Swift enum → pure reducer appends `text-delta` by part id → one streaming source per text/reasoning part, finished at `text-end`/`finish`; stored messages render statically. Code colours come from a highlight.js theme generated from our tokens (no Shiki on iOS). Not benchmarked; speed figures are the libraries' own claims. Detail: `.context/research/ios/streaming-markdown.md` on `research/ios-streaming-markdown`.
