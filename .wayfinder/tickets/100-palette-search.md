---
id: "100"
title: "⌘K search: prefix matches, no flashing, Enter opens the top result"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-01): "command k search isn't working either - it's kind of flashing a bit". The loop recorded the palette frame by frame while typing "query", then backspacing, then typing "xyz" (e2e mock data, a chat whose messages say "Query selection"). It found four problems:

1. **No prefix matches.** "q", "qu", "que" and "quer" find nothing; only the whole word "query" does. `searchConversations` (`packages/db/src/queries/conversations.ts`) uses `websearch_to_tsquery`, which treats every word as complete.
2. **Results vanish on every keystroke.** `usePaletteSearch` (`packages/palette/src/use-palette-search.ts`) shows server hits only while `server.query === trimmed`, so they disappear on each key and come back ~150ms later.
3. **An empty "Chats" heading with a spinner** appears on every keystroke of two or more characters, and disappears when nothing is found.
4. **The highlight stays on "Ask AI"** when a chat result arrives above it, so Enter asks the AI instead of opening the chat.

The palette is `cmdk` inside our Base UI dialog, as in shadcn's Base UI variant. The library isn't the problem, and it stays.

## Done when

- **Prefix search on the server:** complete words keep `websearch_to_tsquery` semantics (quotes, `-word`), and the last word, while still being typed, also matches as a prefix (`to_tsquery(... 'word:*')`, safely escaped). Titles also match by prefix. Tested in `packages/db` against PGlite: "que" finds "Query selection", quotes and `-word` still work, injection-shaped input is harmless.
- **No flashing:**
  - While a new search runs, the previous server hits stay, re-ranked locally and dropping those that no longer match the text.
  - Nothing clears between keystrokes.
  - The searching indicator is quiet: a small spinner in the input row, shown only after ~300ms. It is never an empty group.
  - A "Chats" heading appears only when there are chats under it.
- **Selection:** when the query changes, or results arrive while the person hasn't moved the selection, the first item is selected. Once they have moved it with the arrow keys, it stays where they put it.
- **Tests:** unit tests for the hook (stale-while-revalidate, no empty group, selection rule), and an e2e test that types "que" and opens the matching chat with Enter, asserting the result list never goes empty between keystrokes while matches exist. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/palette/src/**`, `packages/db/src/queries/conversations.ts` (search only) and its tests, `e2e/tests/shell.spec.ts` or a new `e2e/tests/palette.spec.ts`.
