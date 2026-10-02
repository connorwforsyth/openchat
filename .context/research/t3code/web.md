# T3 Code web client compared with openchat

## How T3's web client is built

- **App shape.** It's a Vite single-page app (`apps/web/vite.config.ts`) using TanStack Router with file routes (`src/routes/*.tsx`) and `autoCodeSplitting`. `defaultPreload: "intent"` fetches a route's code on hover or focus (`src/router.ts`). It runs the React Compiler through Babel (`reactCompilerPreset()` in vite.config) and uses Base UI and shadcn (`src/components/ui/*`).
- **State has three layers:**
  1. Effect atoms (`@effect/atom-react`) for server state. They're built in `packages/client-runtime/src/state/*` and connected up in `apps/web/src/state/*.ts`, e.g. `useEnvironmentThread` in `state/threads.ts`.
  2. A pure event reducer (`client-runtime/src/state/threadReducer.ts`) that folds WebSocket orchestration events into a thread and returns `updated | deleted | unchanged`. Snapshots carry a `snapshotSequence` so a reconnect can resume from where it left off.
  3. zustand stores for UI-only state: `composerDraftStore.ts` (4.3k lines), `queuedMessageStore.ts`, `promptStashStore.ts`, `uiStateStore.ts`, `rightPanelStore.ts`.
- **Offline cache.** Shell, thread, server-config and branch-ref stores are written to IndexedDB (`src/connection/storage.ts`, behind the `EnvironmentCacheStore` port in `client-runtime/src/platform/persistence.ts`). A thread is persisted only once its turn has finished (`client-runtime/src/state/threads.ts` around line 405: "persist once it settles so cache encoding stays off the streaming path"). A thread loads its last 10 user turns first, then "load earlier" (`INITIAL_THREAD_USER_TURN_LIMIT`, threads.ts:49).
- **First paint.** An inline script in `index.html` paints a splash in the selected theme before React mounts. `main.tsx` waits for `router.load()` and the auth chunk before the first render, so the splash goes straight to real UI with no blank frame. `lib/chunkReloadGuard.ts` reloads once on `vite:preloadError` when a deploy has made the hashed chunks stale.
- **Thread timeline.** `components/chat/MessagesTimeline.tsx` (5k lines) is **virtualised with `@legendapp/list`**: `estimatedItemSize`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`, `anchoredEndSpace`. Each work-log group gets its own inner LegendList with `recycleItems` (line ~3101). Rows go through `useStableRows`, which reuses the old row object when nothing changed (line ~4088, `computeStableMessagesTimelineRows` in `.logic.ts`). Scroll position and which sections are expanded are remembered per thread in a 100-entry in-memory LRU (`timelineScrollAnchoring.ts:130`).
- **Tests.** About 400 Vitest files under jsdom with `react-test-renderer`. Most logic is split into `*.logic.ts` files and tested as pure functions. `src/test/reactHookHarness.ts` mocks React's hooks so components can be called as plain functions. There are vitest bench files (`src/performance.bench.ts`, `client-runtime/src/remotePerformance.bench.ts`). **There are no browser-mode or Playwright tests for apps/web.**
- **i18n: none.** Strings are hard-coded English, for example the labels in `ComposerPendingApprovalPanel.tsx`.

## Rendering performance techniques

| Technique | T3 location | What it does |
|---|---|---|
| Incremental Shiki highlighting | `lib/incrementalHighlighting.ts` | Keeps Shiki's tokeniser state at the last completed line and only re-highlights the new tail. Falls back to a full pass on CR or plain text. |
| Oniguruma WASM engine forced | `lib/syntaxHighlighting.ts` | `PREFERRED_HIGHLIGHTER = "shiki-wasm"`, because the JS regex engine "can backtrack catastrophically and hang the tokenizing thread". One highlighter promise is cached per language and falls back to `text`. |
| Finished code blocks cached | `ChatMarkdown.tsx` ~1086–1180 | Finished blocks go into an LRU (`highlightedCodeCache`). While streaming, lines are mounted one by one (`preserveLines`). The block keeps its height but stays hidden until Shiki has coloured it, so plain text never flashes. |
| Incremental markdown parse | `markdown-incremental.ts` | Caches the mdast for everything up to the last closed top-level code fence followed by a blank line, and parses only the rest. Turned on only while streaming and only when the text contains a fence. |
| Stable component map | `ChatMarkdown.tsx` ~2786 | `CHAT_MARKDOWN_COMPONENTS` is defined at module level and reads changing state from context, so streaming never changes component types. |
| Fade-in for streamed blocks | `index.css` ~1927 | `.chat-markdown[data-streaming] > *` gets `@starting-style { opacity: 0 }`. Opacity only, one shot, and only while streaming, so reopening a finished thread doesn't replay it. |
| Animations paused when not visible | `lib/visibleAnimation.ts` + `index.css` ~489–600 | One shared IntersectionObserver sets `--visible-animation-state` (paused or running) and `--visible-animation-will-change`. It also checks whether the tab is visible and `prefers-reduced-motion`. |
| Delayed status | `client-runtime/src/delayedStatus.ts` | A status is only shown if it lasts more than 400 ms, and once shown it stays at least 400 ms, so sync spinners don't flicker. |
| Diff worker pool | `components/DiffWorkerPoolProvider.tsx` | One `@pierre/diffs` worker pool shared across the app, kept for 30 s after the last viewer closes. |

## Composer and other surfaces

- **Composer.** A Tiptap editor (`ComposerPromptEditorTiptap.tsx`). Triggers for `@path`, `$skill`, `/command` and `/model` (`packages/shared/src/composerTrigger.ts`). Slash-command ranking knows where the cursor is: provider commands are only offered at the start of the prompt (`composerSlashCommandSearch.ts`).
- **Queued messages.** `queuedMessageStore.ts` and `QueuedMessageSender.tsx` hold a full snapshot of the draft, including the model and mode it was queued with. A queued message goes out at the next tool-call boundary (`queuedAfterToolActivityId`). Mod+Shift+Enter sends it now ("steer").
- **Prompt recall.** ArrowUp in an empty composer walks back through the thread's sent prompts (`composerPromptHistory.ts`). It's worked out from the thread's messages, so there's no store to keep in sync.
- **Drafts and stash.** Drafts are saved per thread in localStorage with a 300 ms debounce, flushed on `beforeunload`, with a versioned schema (v9) and migrations (`composerDraftStore.ts:85–130`). `promptStashStore.ts` is a stash bound to Mod+S.
- **Approvals.** These replace the composer area (`ComposerPendingApprovalPanel.tsx` and `…Actions.tsx`), showing a "1/N" count and Decline / Accept / "Always allow this session".
- **Keybindings.** VS Code-style rules with `when` expressions (`packages/contracts/src/keybindings.ts`, defaults and parser in `packages/shared/src/keybindings.ts`). Users can configure them; they're stored on the server and edited in `settings.keybindings.tsx`. Holding the modifier shows "jump to thread" hints after 200 ms (`shortcutModifierState.ts`, `Sidebar.logic.ts:44`).
- **Sidebar.** Sections are pinned, active, working, snoozed and settled, with drag-and-drop between them (`Sidebar.logic.ts`). `ThreadNotificationCoordinator.tsx` sends a desktop Notification and sets a badge when a background turn finishes. Rows only subscribe to live data while active (`useSidebarRowSubscriptionLease`).
- **Command palette.** 3.5k lines with modes root, browse and submenu, plus file and content search. The state machine is a pure reducer (`CommandPalette.logic.ts`, `reduceCommandPaletteUiState`).

## Where openchat stands on the same things

- **Conversation.** `packages/chat-ui/src/conversation/conversation-view.tsx` is not virtualised (by D27), uses `content-visibility:auto` on older rows, and memoises `MessageRow` with a shallow comparator (`message-row.tsx:450`). That already does what T3's structural sharing does.
- **Markdown.** Streamdown 2.6 through `MessageResponse` (`packages/ui/src/components/ai-elements/message.tsx:336`). Maths loads lazily (`conversation/markdown.tsx`). **Code fences are not syntax-highlighted**: the README in `packages/ui/src/components/ai-elements/` says "Streamdown renders fences without highlighting", and no `@streamdown/code` plugin is installed.
- **Streaming.** `useChat` is throttled to 16 ms (`packages/client/src/use-run-chat.ts`).
- **Offline cache.** A selected slice of the TanStack Query cache is saved to IndexedDB with idb-keyval (`apps/web/app/(app)/_shared/query-persistence.ts`). The inline pre-paint script for the shell is `shell-prepaint.ts`.
- **Shortcuts.** `packages/shortcuts`: a zod registry with scopes (`global | chat | palette`), conflict detection, user overrides through ports, Electron accelerators, and Lingui descriptions. This matches T3's system, with better typing.
- **Composer.** Busy state shows Stop only (`composer-footer.tsx:226–250`). **There's no queue, no prompt recall, and no per-chat persisted draft.**
- **Tests.** Vitest browser mode, Playwright (`playwright.config.ts`, `e2e/`), and Lingui throughout. These are all ahead of T3.

## Recommendations, ranked by value

**1. Highlight code blocks in chat, incrementally.** (High)
- **T3:** `lib/incrementalHighlighting.ts`, `lib/syntaxHighlighting.ts`, `ChatMarkdown.tsx` 1086–1180.
- **openchat:** fences render as plain text.
- **What to do:** openchat already ships `@pierre/diffs` in `packages/code-ui` (worker pool in `code-ui-provider.tsx`). Pass a code component to Streamdown from `packages/chat-ui/src/conversation/markdown.tsx` that lazily loads a code-ui highlighter. Highlight synchronously only up to the last completed line while streaming, and cache finished blocks in an LRU keyed on code, language and theme. Copy two details:
  - Force `"shiki-wasm"`, since the JS regex engine can hang on hostile model output.
  - Keep the block's height but leave it hidden until it's coloured. The hidden-to-visible switch must be an opacity change, per AGENTS.md.

  Keep it lazy so it doesn't touch D27's "composer first" boot.

**2. Likely bug: the `MessageResponse` memo ignores `isAnimating`.** (High, small fix)
- **Where:** `packages/ui/src/components/ai-elements/message.tsx:352` compares only `children`.
- **Why it matters:** Streamdown reads `isAnimating` from context to turn its controls on and off (code copy, table and mermaid actions). When a stream ends, the last render usually has the same text, so the change to `isAnimating=false` may never reach Streamdown, and its controls can stay in the streaming state until something remounts the message.
- **Fix:** compare `isAnimating` (and `plugins`) in the memo comparator. Add a browser test that finishes a stream with unchanged text and checks that the copy button is enabled.

**3. Queue follow-ups while a run streams, plus "steer now".** (High for an agent product)
- **T3:** `queuedMessageStore.ts` (snapshot including model and mode), `QueuedMessageSender.tsx`, `components/chat/sendQueuedMessage.ts`, and the `thread.steerQueuedMessage` binding.
- **openchat:** Enter does nothing while busy; the only button is Stop.
- **What to do:** add a client-side queue in `packages/chat-ui/src/chat/connected-chat.tsx` (pure reducer plus a port) that sends when the run finishes. Show queued rows above the composer with remove and "send now" (Mod+Shift+Enter in the `packages/shortcuts` registry). Skip T3's tool-boundary rule until openchat's runs can accept input mid-run.

**4. Per-chat persisted drafts and ArrowUp prompt recall.** (Medium-high, cheap)
- **T3:** `composerDraftStore.ts` (300 ms debounce, flush on `beforeunload`, versioned schema) and `composerPromptHistory.ts` (history built from the thread's messages, keyed by id, falling back to text).
- **openchat:** a draft lives only in the mounted Tiptap instance.
- **What to do:** add a `DraftStore` port to `packages/composer` (localStorage adapter plus in-memory fake, zod-versioned), keyed by conversation id, and store the Tiptap JSON. Prompt recall is a pure function over `messages.path`, so there's no store to add. Skip T3's 4.3k-line store: it covers attachments, terminal contexts and worktrees that openchat doesn't have.

**5. Fade in streamed blocks with `@starting-style`.** (Medium, tiny)
- **T3:** `index.css` ~1927–1940.
- **What to do:** put a `data-streaming` attribute on the Streamdown wrapper and fade direct children in with opacity only, using `duration-(--motion-base)` and `ease-motion-out` rather than T3's hard-coded 600 ms. Gating on `data-streaming` keeps reopened threads from replaying it. This fits D28. Check whether Streamdown's own `animated` option already does this before adding CSS.

**6. Delayed-status helper.** (Medium, tiny)
- **T3:** `client-runtime/src/delayedStatus.ts`.
- **What to do:** a pure `createDelayedStatus` (show after 400 ms, keep at least 400 ms), probably in `@workspace/shared`, with a hook in `packages/client`. Use it for "reconnecting", revalidating persisted queries, and tool spinners, so a quick refetch from the restored cache doesn't flash. The timings should come from motion tokens or `motionMs`.

**7. Remember scroll position per chat.** (Medium)
- **T3:** `timelineScrollAnchoring.ts:130–141`, which also remembers expanded and collapsed sections.
- **openchat:** `MessageScrollerProvider key={conversationKey}` resets to the bottom on every switch.
- **What to do:** a module-level LRU (about 100 entries) of `{ atEnd, anchorMessageId, offset, openReasoningIds }`, restored when the view mounts. Switching back to a long chat mid-read is a common complaint, and the cost is small.

**8. Background-run indicators and completion notifications.** (Medium; depends on a live signal)
- **T3:** the sidebar's "working" section, `ThreadStatusIndicators.tsx`, and `ThreadNotificationCoordinator.tsx` (Notification only when the tab is hidden or unfocused).
- **openchat:** `sidebar/chat-row.tsx` has no running or unread state.
- **What to do:** a "running" dot from an active-runs query (polling is fine until there's a push channel), plus an opt-in browser notification and `document.title` badge when a run finishes while the tab is hidden. Every string goes through Lingui.

**9. Load long chats in pages instead of virtualising.** (Medium-low)
- **T3:** 10 turns first, then "load earlier" (`client-runtime/src/state/threads.ts:49`, `TimelineLoadEarlierHeader`).
- **What to do:** if `messages.path` gets heavy, add a cursor to the path query. That keeps D27 (find-in-page within what's loaded) and limits first-render work. **This changes `packages/contract` and needs its own PR.**

**10. Jump hints shown while the modifier is held.** (Low-medium)
- **T3:** `shortcutModifierState.ts`, `THREAD_JUMP_HINT_SHOW_DELAY_MS = 200`.
- **What to do:** add Mod+1…9 "go to chat N" to the registry and show `ShortcutKbd` hints after holding Mod for 200 ms. The hints appear instantly and don't animate (keyboard-driven UI). Copy T3's handling of stuck modifiers: reset on blur and paste.

**11. Recover from stale chunks after an upgrade.** (Low-medium for self-hosting)
- **T3:** `lib/chunkReloadGuard.ts` plus the `vite:preloadError` handler in `main.tsx`: reload once, guarded by sessionStorage.
- **What to do:** add the same guard in a client error boundary for `ChunkLoadError` once the Next 16 docs have been checked.

**12. Benchmarks for hot paths.** (Low)
- **T3:** `src/performance.bench.ts` (sorting 1,000 threads, deriving a plan from 500 activities).
- **What to do:** add vitest bench files for `buildBranchPath`, palette `scoreText` over the cached item set, and `indexToolResults`. They're cheap ways to catch regressions in the pure core.

**13. React Compiler.** (Low, try with care)
- T3 runs it everywhere. Next 16 has a `reactCompiler` option, but it brings Babel into a build that relies on the Lingui SWC plugin. Measure build time and check that the Lingui macros survive before adopting. openchat's explicit memo comparators already do the important part.

**Already at or above T3:** turning transitions off during theme changes (`disableTransitionOnChange` in `apps/web/components/theme-provider.tsx`), shortcut conflict detection, the persisted query cache, the pre-paint script, row memoisation, i18n, and browser and E2E tests.

## What not to copy

- **The huge components.** `ChatView.tsx` is 10.4k lines, `ChatComposer.tsx` 7.1k, `MessagesTimeline.tsx` 5k, `Sidebar.tsx` 5.2k. Their `*.logic.ts` split is good; the size of the files isn't.
- **LegendList virtualisation of the whole thread.** It conflicts with D27 (find-in-page). T3's state-machine knobs for following the end, anchoring a new turn and restoring position are a large source of bugs. The one idea worth keeping is virtualising a single very long tool-output list inside a row, if openchat ever streams thousands of log lines.
- **Effect atoms alongside zustand.** Two state systems with a heavy runtime. TanStack Query plus small zod-typed stores is the right fit for openchat.
- **GPU-heavy styling.** `backdrop-filter: blur()` glass across the chrome (`index.css` 323–402); `live-tool-shine`, which animates `background-position`; and `AnimatedHeight.tsx`, which animates `height`. All three break openchat's transform-and-opacity rule.
- **Colour literals.** Hex and oklch values in the boot script and duplicated theme palettes (`index.html`), plus the theme editor and VS Code theme import. These go against openchat's token rule and add a lot of surface area.
- **T3's test approach.** jsdom, `react-test-renderer`, and mocking React's own hooks (`src/test/reactHookHarness.ts`). openchat's browser mode and Playwright are better.
- **Hard-coded English strings.** Anything copied has to go through Lingui.
