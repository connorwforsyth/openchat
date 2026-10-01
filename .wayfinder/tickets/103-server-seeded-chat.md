---
id: "103"
title: "A chat opened cold renders its messages from the server, with no extra round trip"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

D27 says the TanStack Query cache is filled by the server. Today only config and the signed-in user are (`apps/web/app/(app)/_shared/app-frame.tsx` `setQueryData`). A chat opened on a new device, or after the persisted cache is cleared, fetches its path, tree, runs and artifacts after hydration (the `/api/__batch__` calls in the dev log), so messages appear one round trip late.

## Done when

- `/c/[id]` loads the conversation's path (the messages on the active branch), its meta, and its active runs on the server, in the same request as the page. It seeds the query cache with them (React Query's dehydrate/`HydrationBoundary`, or `setQueryData`, matching how config is seeded), so the first paint shows the messages.
- **Access:** checked exactly as the API checks it. A chat the person can't read gets the same 404 as today, and nothing leaks into the HTML.
- **Persisted cache:** when the IndexedDB cache has the chat, it still renders instantly. The server's seed must not cause a visible flash or a double render.
- **Streaming:** large chats don't block TTFB. The page streams, with messages in a Suspense boundary under the shell, and the composer still becomes ready first (D27).
- **Tests:** an e2e test that clears storage, opens a chat, and asserts its messages are in the server HTML and that no client fetch of the path happens before first paint; TTFB and `composer:ready` timings stay within today's numbers.
- Gate and e2e pass. No `packages/contract` change.

## Owns

`apps/web/app/(app)/(chat)/**`, `apps/web/app/(app)/_shared/**` (query seeding), `packages/chat-ui/src/chat/**` (only if needed for seeding), e2e.

## Results (2026-10-01, loop)

Branch `t/103-server-seeded-chat`, not pushed; `status` stays `open`. No `packages/contract` change, no new dependency.

**What's seeded, and how.** `c/[id]/page.tsx` starts `loadChatSeed(id)` and hands the promise, not the answer, to `ChatSeedFiler` (`chat-seed.tsx`). The seed is the conversation (`conversations.get`), its branch on the caller's active leaf (`messages.path`), and its active runs (`runs.list`, the same input as `useChatQueries`, now `activeRunsInput` in `chat-ui/chat/seed.ts`). Two consumers:

- **The screen.** The layout renders the page before `ChatRoute`, so the filed seed is there when the screen first renders, on the server and at hydration. `ChatScreen` renders the conversation inside its own `<Suspense>`, and `SeededConversation` takes the branch from the seed (`use()`) while the screen has no messages. The rows are in the page's HTML; the header, sidebar and composer don't wait for them.
- **The query cache.** In a layout effect (after hydration, before any query mounts), the three queries are started with the seed as their fetch. The screen's queries join those fetches, so the browser never asks for the branch. The seed answers once: an invalidation refetches with the query's own options, so later fetches go to the API.

The seed counts only for the page's own load. On a client navigation the server's read races what the page is doing (the first message of a chat it just created), so the screen fetches for itself as before. The server also skips the read for Next's `RSC` requests.

**Access.** The server calls the API in-process over loopback with the caller's cookie (`getServerApi`, split out of `getViewer` in `lib/server-session.ts`). Every answer has been through the same session and access checks as the browser's request. Anything short of three answers seeds `null`: the screen then fetches as before and gets the API's own `NOT_FOUND`. The chat screen for a chat you can't read is unchanged (200, empty screen), and nothing of the chat is in the HTML. `seeded-chat.spec` checks this as Ben on Ada's chat, against both the raw response and the page.

**Persisted cache.** A restored IndexedDB copy skips queries the page is already fetching (`skipFetching`), so an older copy never stands in for the server's read. A reload with the chat in IndexedDB shows the server's rows, then the same rows; the spec checks that the rows never disappear, that hydration doesn't mismatch, and that no path fetch happens.

**Streaming.** The read never blocks the shell. With the read delayed 300 ms as an experiment, TTFB stayed at baseline and the rows arrived later. In practice the read usually finishes before the shell flushes, so the rows are in the first paint. When it finishes after the shell, React 19.2 holds the streamed rows in a hidden node and reveals them at least 300 ms after first paint. Any update to the screen before that renders the boundary on the client (identical rows), and the hidden copy lingers until React's reveal. That case is correct but redundant; the e2e row helpers now count visible rows only.

**Timings.** Cold open of `/c/[id]`, production build, embedded PGlite. Best of 20 opens per build, on the runs where the machine was quiet:

| | TTFB | composer:ready | first message visible |
|---|---|---|---|
| before | 14–15 ms | 259–261 ms | 319–323 ms |
| after | 28–31 ms | 301–309 ms | 51–56 ms |

The suite's own medians, single samples: before 20 / 301 / 376 ms, after 32–33 / 306–324 / 54–56 ms. `/` (new chat) is unchanged.

So the branch is on screen ~270 ms sooner with no client round trip, but **TTFB (+~15 ms) and composer:ready (+~40 ms) did not stay within today's numbers on the embedded database**. The cost is the read itself: three API calls whose PGlite queries run on the server's one thread while the shell renders and the JS is served. Reading after the viewer lookup rather than alongside it (`faf0cd4`) took about a third off. Deferring the read past the shell brings TTFB back to baseline, but then React's reveal throttle holds the rows until ~260 ms, and composer:ready didn't clearly improve. The machine was heavily loaded by other agents for most of this (load averages 20–390), so differences under ~15 ms are near the noise.

**Bugs found on the way, fixed.**

- The seed's fetch stayed on its queries, so every refetch answered with the server's first read (harness.spec's second tab kept a cancelled card).
- A page rendered from the server's read could show a run that had ended before hydration. Following it now refreshes the chat when there turns out to be no stream (`useFollowRunningReply`).
- The navigation race above (sharing.spec and context.spec failed about one run in four; 0 in 6 on the baseline and after the fix).

**Tests.**

- `e2e/tests/seeded-chat.spec.ts`: cold open has the rows in the server's HTML; no path fetch through hydration and a persisted-cache reload; no hydration errors; rows never drop; first-message timing recorded; Ben gets nothing of Ada's chat.
- `chat-seed.test.ts`: seed fills the queries without the API; a later refetch asks the API; no seed or a failed seed fetches as before.
- `query-persistence.test.ts`: `skipFetching`.

**Checks.** `gate.sh` 82/82 (one earlier run had a `@workspace/db` test fail under load; it passed alone). `E2E_PORT=3212 bun turbo test:e2e` 56/56, twice in a row.

**Open questions for Connor.**

1. Accept the TTFB/composer:ready cost for messages in the first paint, or defer the read past the shell (TTFB unchanged, rows at ~260 ms, no client round trip)? On Postgres the read's DB work leaves the server's thread, so the cost should shrink; not measured here.
2. The navigation guard leans on Next's `RSC` request header to skip the server read. If Next stops sending it, the server just does the read and the client ignores it.
3. A chat you can't read still answers 200 with an empty chat screen, as before. Should the page `notFound()` when the seed comes back `NOT_FOUND`? That would block the page on the read.
