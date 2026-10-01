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
