---
id: "182"
title: "Which native renderer draws streaming markdown and code in SwiftUI?"
labels: [wayfinder:research]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

Replies stream as AI SDK UI message parts (text deltas, reasoning, tool parts). Compare OSS options for rendering markdown natively on iOS 26 while it streams: `AttributedString(markdown:)`, Apple's `swift-markdown` + own views, Textual (gonzalezreal's MarkdownUI successor), others current in 2026. Criteria: incremental updates without re-layout jank on long replies, code blocks with syntax highlighting (which highlighter, licence), tables, math if cheap, text selection and copy, dark/light theming from our tokens, Dynamic Type. Recommend one, with a sketch of how deltas feed it.

Findings: `.context/research/ios/streaming-markdown.md` on branch `research/ios-streaming-markdown`.
