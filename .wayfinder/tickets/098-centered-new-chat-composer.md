---
id: "098"
title: "A new chat has its composer in the middle of the page"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Connor asked (2026-10-01): on a new chat the composer should sit centred on the page, not at the bottom; once the chat starts it moves to the bottom, as ChatGPT and Claude do.

## Done when

- With no messages, the composer is vertically and horizontally centred (a little above true centre, as ChatGPT does), with the existing empty-state greeting above it if there is one.
- On the first send it moves to the bottom with one short layout transition (respect `prefers-reduced-motion`: jump), and the conversation appears above it. It never jumps back while a chat has messages; a reload of a started chat renders it at the bottom from the first paint (no flash of a centred composer, server-rendered correctly).
- Attachments, the + menu, the model picker and the Workspace panel all work in both positions; the composer keeps focus through the move.
- Mobile (375px): centred too, and the on-screen keyboard doesn't hide it.
- e2e: new chat → composer centred (bounding box near the middle); send → composer at the bottom; reload → at the bottom immediately. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/chat-ui/src/chat/**` (layout only), `packages/chat-ui/src/conversation/**` (empty state), `apps/web/app/(app)/(chat)/**` (layout only), `e2e/tests/chat*.spec.ts`.

## Results (2026-10-01, loop)

- **What decides the position.** `composerPlacement` in
  `packages/chat-ui/src/chat/composer-dock.tsx` (pure): centred while the chat
  has no id, no messages and no first send yet; at the bottom otherwise.
  `useComposerPlacement` wraps the composer's `onSubmit` so a first send moves
  it down at once (before the chat it creates has an address), and wraps
  `onNewChat` so a new chat brings it back.
- **How it renders.** The composer (`ComposerDock`) is always the same element
  in the flow at the bottom of the conversation column, so it keeps focus and
  its draft when it moves. The column is a CSS size container; centred, the
  dock is moved up by `translate-y-[calc(50%-55cqh)]` (its middle 45% down;
  60cqh, 40% down, below `md` so a phone's keyboard leaves it visible). No
  measuring, so the server renders it in place: `/` has
  `data-placement="center"` in its HTML, `/c/[id]` has `bottom` (the id comes
  from the route on the server), and a reloaded chat never flashes a centred
  composer, nor the greeting while its messages load (it used to show the
  greeting until then).
- **The transition.** Only `transform` moves (D28): the bottom state carries
  `transition-transform duration-(--motion-base) ease-motion-in-out`, the
  centred one none, so the move down slides and the way back (a new chat)
  jumps; `motion-reduce:transition-none` jumps both.
- **Empty state.** `EmptyState` became `EmptyGreeting` (above the centred
  composer) and `EmptySuggestions` (under it); the conversation's empty slot
  is now a spacer. `connected-chat.tsx` and `packages/composer` untouched; no
  contract change.
- **Checked by hand (screenshots):** model picker, an attachment and the
  Workspace panel while centred; send with the panel open docks it in the
  narrower column.
- **Tests:** chat-ui unit tests for `composerPlacement` and the screen (centred
  on a new chat, bottom on a started chat before its messages load, first
  send moves it down at once with focus kept, New chat brings it back). e2e
  `chat.spec.ts`: server HTML says `center` on `/`, composer middle between
  35% and 55% of the column, send docks it (within 40px of the bottom) with
  focus kept, server HTML says `bottom` for `/c/[id]`, and after a reload it
  is at the bottom immediately. Gate 82/82; e2e 55 passed (54 + 1 new).
  Timings: `composer:ready` 257 ms on `/`, 146 ms on `/c/[id]` reload.
- **Open:** a real iOS keyboard isn't covered by any test (Chromium can't
  emulate it); 40% down on a phone keeps the composer above a typical
  keyboard on a 812px-tall screen. PR #74's + menu lives inside the composer,
  so it moves with it; nothing here touches its files.

## Resolution (2026-10-01, loop)

Merged on Connor's go-ahead ("happy to start merging"), after a rebase and the full local gate (incl. `evals --strict`) and e2e on the rebased branch. [PR #78](https://github.com/connorwforsyth/openchat/pull/78).
