# Which native renderer draws streaming markdown and code in SwiftUI? (ticket 182)

Researched 2026-10-20. Library facts come from each project's GitHub repo:
README, `Package.swift`, LICENSE, issues, and `gh api` for stars, last push
and releases. Repo code was read at `51c75b2` (main). Nothing was built or
benchmarked. All performance claims below are the projects' own.

## Verdict

**Use [MarkdownView](https://github.com/LiYanan2004/MarkdownView) 3.x
(LiYanan2004, MIT), behind a thin `MessageMarkdown` view of our own.** Of the
mature options, it is the only general-purpose renderer with a streaming
pipeline built in:

- `StreamingMarkdownSource` and `StreamingMarkdownReader` parse on a
  background task and reuse finished blocks.
- Renders are throttled (50 ms by default).
- `finishStreaming()` does one final full parse.

It also covers the rest of the criteria:

- GFM through Apple's `swift-markdown`.
- Code highlighting through Highlightr (highlight.js, BSD-3).
- Maths through SwiftMath (MIT, native).
- Continuous text selection through `MarkdownText`.
- iOS 16+, so iOS 26 is fine.

**Runner-up: Microsoft's
[SwiftStreamingMarkdown](https://github.com/microsoft/SwiftStreamingMarkdown)
(MIT).** It is built for exactly this job (LLM chat):

- It rewrites unfinished emphasis and tables while streaming, the way
  Streamdown does on the web.
- It animates new text and has citation pills.
- Its theme is one `MarkdownRenderConfig`.

It loses on two counts. It is young (v0.7.0). And it has no inline selection
across blocks: a "Select more text" item opens a modal instead. Prototype 187
should run both on the same long reply and keep MarkdownView unless the
numbers say otherwise.

**Watch [Textual](https://github.com/gonzalezreal/textual)** (the successor to
MarkdownUI). It has the nicest API and native selection, and is probably the
long-term answer. Today it re-parses the whole string on every update (open
issue #47). Open issue #87 reports a crash on iOS 26 when streamed content
changes during a selection.

## Comparison

Stars and last push are from 2026-10-20.

| | MarkdownView 3.x | SwiftStreamingMarkdown | Textual | MarkdownUI | `AttributedString(markdown:)` | swift-markdown + own views |
|---|---|---|---|---|---|---|
| Licence | MIT | MIT | MIT | MIT | Apple SDK | Apache-2.0 (cmark-gfm: BSD-2 + MIT parts) |
| Activity | 841★, pushed 2026-09-29, 3.0.0 (2026-07-05) | 382★, pushed 2026-10-16, v0.7.0 (2026-08-02) | 905★, pushed 2026-06-15, 0.5.0 | 3.9k★, **maintenance mode**, 2.4.1 (2024-10) | iOS 15+ | 3.4k★, 0.9.0 (2026-09-21) |
| Min iOS | 16 | 16 | 18 | 15 (tables 16) | 15 | n/a |
| Parser | swift-markdown (cmark-gfm) | swift-markdown + partial-syntax rewriters | Foundation `AttributedString(markdown:)` | swift-cmark (GFM) | Foundation | cmark-gfm |
| **Streaming** | **Built in.** Background incremental parse, reuses finished blocks, 50 ms throttle | **Built in.** Takes full snapshots, parses incrementally, repairs partial emphasis and tables, animates text | None. Full synchronous re-parse each update (#47) | None | None. Re-parse everything | Do it yourself |
| Code highlighting | Highlightr (highlight.js via JavaScriptCore, 185 langs) | HighlightSwift (highlight.js via JavaScriptCore; pinned revision, upstream quiet since 2024) | Prism.js via JavaScriptCore, in an actor | `CodeSyntaxHighlighter` protocol (bring Splash etc.) | none (`languageHint` only) | bring your own |
| Tables | yes | yes, with alignment, copy and download hooks | yes | yes | tagged by `PresentationIntent`, not laid out | bring your own |
| Task lists | yes (GFM) | yes, display only | unverified (no `PresentationIntent` case) | yes | no | yes (parser) |
| Maths | SwiftMath (native, MIT), on by default | iosMath fork (native) | swiftui-math (native, MIT) | no | no | bring your own |
| Selection and copy | `MarkdownText`: continuous selection (RichText) | context menu plus "Select more text" modal | native `.textual.textSelection(.enabled)` | one paragraph at a time (#264) | `Text` selection only | bring your own |
| Theming | styles per block (code, table, quote) | `MarkdownRenderConfig` (one source of truth) | `.default` / `.gitHub` styles plus custom | themes | `Text` styling | full control |
| Cost | Highlightr + SwiftMath + RichText | about 1 MB (README) | small | small | none | large build effort |

**Not chosen:**

- **Down** is CommonMark only and has been stale since 2023.
- **Ink** outputs HTML, not views.
- A handful of streaming packages from 2026 have under 2 stars each:
  `tooszovski/MarkdownMath`, `Jimmy-Jung/RichMarkdown`,
  `euforicio/streamdown-swift`.

### Highlighters, if we swap one in

| Library | Licence | Engine | Notes |
|---|---|---|---|
| [Highlightr](https://github.com/raspu/Highlightr) | MIT (highlight.js BSD-3) | JavaScriptCore | 185 langs, 89 themes; README says about 50 ms for 500 lines on an iPhone 6s; 2.3.0 (2025-06) |
| [HighlightSwift](https://github.com/appstefan/HighlightSwift) | MIT | JavaScriptCore | async API returns `AttributedString`; last push 2024-11 |
| [Splash](https://github.com/JohnSundell/Splash) | MIT | pure Swift | Swift grammar only, so not enough for chat |
| [SwiftTreeSitter](https://github.com/ChimeHQ/SwiftTreeSitter) and [Neon](https://github.com/ChimeHQ/Neon) | BSD-3 | tree-sitter | incremental and fast, but one grammar package per language, and Neon's README says main is "not quite ready" |

**Note:** the web highlights with Shiki and a theme drawn from our tokens
(`packages/code-ui/src/theme/code-theme.ts`). No native option shares that
engine. To keep the two looking alike, generate a highlight.js theme from the
same token values, using the token script the map already plans (globals.css →
asset catalog). Don't try to match token scopes one for one.

## How the web does it today (what iOS mirrors)

- **Wire.** `GET /api/runs/{id}/stream` sends SSE, one AI SDK
  `UIMessageChunk` per event. The event `id` is a sequence number, and
  `?cursor=` resumes from it (`packages/client/src/run-stream.ts:3-7`). The
  server merges adjacent `text-delta` / `reasoning-delta` chunks for the same
  part before storing them. One delta carrying `"ab"` renders the same as
  `"a"` then `"b"` (`packages/server/src/stream/coalesce-deltas.ts:8-13`).
- **Accumulate.** `useChat` with a run transport appends each delta to its
  part by `id`. UI updates are throttled to 16 ms
  (`packages/client/src/use-run-chat.ts:21,101`).
- **Shape.** `messageView` turns parts into `RenderBlock`s: `text`,
  `reasoning`, `tool`, `memory`, `files`, `artifact`, `annotation`, `plan`,
  `skills` and `plan-approval` (`packages/chat-ui/src/model/parts.ts:123-163`).
  Only `text` and `reasoning` are markdown
  (`packages/chat-ui/src/conversation/message-row.tsx:140-143`). Rows are
  memoised, so a token re-renders only the streaming row (`message-row.tsx:465-477`).
- **Render.** Streamdown `^2.6.0` (`packages/ui/src/components/markdown.tsx`)
  repairs unfinished fences and tables while `isAnimating` is set
  (`packages/chat-ui/src/conversation/markdown.tsx:45-50, 81-91`). The end of
  a stream can arrive with only `streaming` flipping, and that must still
  re-render (`markdown-stream-end.test.tsx`, ticket 144).
- **Code.** The Shiki plugin keeps each open block's grammar state at its last
  finished line, so a chunk only tokenises new lines. A block stays hidden
  (keeping its height) until it is coloured, so plain text never flashes
  (`code-plugin.ts:9-13`, `markdown.tsx:30-36`).
- **Maths.** Only `$$…$$`, `\[…\]` and `\(…\)` count; single `$` stays text
  (`markdown.tsx:10-14`).

## Delta → render pipeline on iOS

```
URLSession.bytes ─▶ SSEParser (AsyncSequence<SSEEvent>)        // ticket 184's parser
                 ─▶ JSONDecoder → UIMessageChunk (Codable enum, `type` discriminator,
                                  unknown types → .unknown, never a throw)
                 ─▶ RunReducer.apply(chunk, to: MessageDraft) -> MessageDraft   // pure
                 ─▶ @MainActor @Observable RunModel  (one per streaming message)
                        parts: [PartID: PartModel]   order: [PartID]
                        PartModel.text  → owns one StreamingMarkdownSource
                 ─▶ MessageRow ── ForEach(parts) ── switch block.kind
                        .text / .reasoning → MessageMarkdown(source)  // StreamingMarkdownReader
                        .tool / .plan / …  → native cards (not markdown)
```

1. **Parse at the boundary.** Decode each event into a `UIMessageChunk` enum
   that mirrors the AI SDK's chunk union: `start`, `text-start`, `text-delta`,
   `text-end`, `reasoning-*`, `tool-input-*`, `tool-output-*`, `data-*`,
   `finish`, `error`. Record `lastEventID` as the resume cursor.
2. **Pure reducer.** `apply` appends `delta` to the part with that `id` and
   returns a new draft. It is the Swift twin of the AI SDK's accumulation,
   unit-tested against recorded chunk fixtures (the same fixtures the web
   tests use, if possible). Because merged deltas are equivalent, the reducer
   doesn't care how the server batched them.
3. **Feed the renderer.** For a `text` or `reasoning` part, the `PartModel`
   creates one `StreamingMarkdownSource` at `text-start` and runs
   `source.text += delta` for every delta. MarkdownView then does the
   heavier work off the main thread: background incremental parsing, reuse of
   stable blocks, and a 50 ms render throttle. Keep the default 50 ms rather
   than the web's 16 ms: native layout of a re-parsed block costs more than a
   DOM diff, and 50 ms still looks continuous. Tune it in prototype 187.
4. **Finish.** On `text-end`, `finish` or a terminal run status, call
   `finishStreaming()`. That triggers the final full parse, which turns on
   copy buttons and highlights the last fence. This mirrors the web's
   "streaming flips with unchanged text" case.
5. **Settled and reopened messages** don't stream. Render the stored `parts`
   with a static `MarkdownView(text)`. Chunks are pruned 600 s after a run
   settles (ticket 181), so the stored message is the source of truth. On
   resume from cursor 0, throw the draft away and create fresh sources:
   replaying is idempotent, and appending onto old text is not.
6. **Keep invalidation narrow.** Rows are `Equatable` on message id and
   version. Only the streaming row observes its `RunModel`, the way the web
   memoises rows. Keep auto-scroll tied to the bottom anchor
   (`ScrollPosition` / `defaultScrollAnchor(.bottom)`), not to every text
   change.
7. **Code blocks.** While a fence is open, show monospace text in the code
   block's final frame. Colour it once Highlightr returns: an opacity change
   only, per D28, and no reflow because the font metrics don't change. If
   Highlightr per update is too slow on a long block, plug in a
   `CodeBlockStyle` that highlights only finished lines and caches by
   (language, text). That is the same trick as the web's grammar-state cache.
8. **Theming and Dynamic Type.**
   - **Colours:** set MarkdownView's styles from the generated asset-catalog
     colours (foreground, muted, border, code background).
   - **Fonts:** relative text styles (`.body`, `.callout`, `.body.monospaced()`)
     so Dynamic Type scales. Check the largest accessibility sizes in the
     prototype, and wrap or scroll wide tables horizontally.
   - **Strings:** copy and other control labels through the app's string
     catalog.

## Risks and open checks for prototype 187

- **One maintainer.** MarkdownView has a single maintainer. Wrapping it in
  `MessageMarkdown`, with the reducer and models independent of it, keeps a
  swap to SwiftStreamingMarkdown or Textual to one file.
- **Unfinished syntax mid-stream.** MarkdownView has no documented equivalent
  of Streamdown's repair step. cmark treats an open fence as code to the end,
  which is fine. A dangling `**` shows literally until it closes. Check
  whether that looks bad. If it does, a small pure "close open emphasis and
  table rows" pre-pass on the source text fixes it.
  SwiftStreamingMarkdown's `PartialEmphasisRewriter` and
  `PartialTableRewriter` show the approach.
- **Cost of `MarkdownText`.** It adds the RichText dependency, and its
  selection was not tested under streaming. Textual's #87 shows that
  combination can crash. Option: enable selection only once the message has
  settled.
- **Maths delimiters.** Match the web's rule: `$$`, `\[ \]` and `\( \)` only,
  never single `$`.
- **Unverified:** Dynamic Type behaviour of each library, and task-list
  rendering in Textual. All performance numbers are the vendors' own.

## Sources

**MarkdownView**
- Repo: https://github.com/LiYanan2004/MarkdownView
- README, "Render streaming Markdown":
  https://github.com/LiYanan2004/MarkdownView/blob/main/README.md
- Streaming design article (DocC):
  https://github.com/LiYanan2004/MarkdownView/blob/main/Sources/MarkdownView/Documentation.docc/Articles/Rendering-Streaming-Markdown-Content.md

**SwiftStreamingMarkdown**
- Repo and README (support list, streaming usage, binary size):
  https://github.com/microsoft/SwiftStreamingMarkdown
- Selection modal:
  https://github.com/microsoft/SwiftStreamingMarkdown/blob/main/Sources/MarkdownText/Models/TextSelectionConfig.swift
- Partial-syntax rewriters:
  https://github.com/microsoft/SwiftStreamingMarkdown/tree/main/Sources/MarkdownText/Parser/Rewriters

**Textual**
- Repo: https://github.com/gonzalezreal/textual
- Issue #47 (full re-parse per update):
  https://github.com/gonzalezreal/textual/issues/47
- Issue #87 (iOS 26 crash during selection):
  https://github.com/gonzalezreal/textual/issues/87

**MarkdownUI**
- Repo and maintenance-mode banner: https://github.com/gonzalezreal/swift-markdown-ui
- Discussion #437: https://github.com/gonzalezreal/swift-markdown-ui/discussions/437
- Issue #264 (selection one paragraph at a time):
  https://github.com/gonzalezreal/swift-markdown-ui/issues/264

**Parsers**
- swift-markdown: https://github.com/swiftlang/swift-markdown
- swift-cmark: https://github.com/swiftlang/swift-cmark

**Foundation**
- `AttributedString(markdown:)`:
  https://developer.apple.com/documentation/foundation/attributedstring/init(markdown:options:baseurl:)
- `PresentationIntent.Kind`:
  https://developer.apple.com/documentation/foundation/presentationintent/kind

**Highlighters**
- Highlightr: https://github.com/raspu/Highlightr
- HighlightSwift: https://github.com/appstefan/HighlightSwift
- Splash: https://github.com/JohnSundell/Splash
- SwiftTreeSitter: https://github.com/ChimeHQ/SwiftTreeSitter
- Neon: https://github.com/ChimeHQ/Neon

**Maths**
- SwiftMath: https://github.com/mgriebling/SwiftMath
- LaTeXSwiftUI: https://github.com/colinc86/LaTeXSwiftUI
- swiftui-math: https://github.com/gonzalezreal/swiftui-math

**Not chosen**
- Down: https://github.com/johnxnguyen/Down
- Ink: https://github.com/JohnSundell/Ink

**Repo code read**
- `packages/chat-ui/src/conversation/markdown.tsx`
- `packages/chat-ui/src/conversation/code-plugin.ts`
- `packages/chat-ui/src/conversation/code-highlighter.ts`
- `packages/chat-ui/src/conversation/message-row.tsx`
- `packages/chat-ui/src/model/parts.ts`
- `packages/ui/src/components/markdown.tsx`
- `packages/client/src/run-stream.ts`
- `packages/client/src/use-run-chat.ts`
- `packages/server/src/stream/coalesce-deltas.ts`
