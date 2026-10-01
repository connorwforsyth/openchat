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

## Results (2026-10-01, loop)

Branch `t/100-palette-search`: three commits (db, palette, e2e) plus this note. No `packages/contract` change, no new dependency.

- **Prefix search** (`packages/db/src/queries/conversations.ts`). `prefixSearchParts` splits the query into the words before the last one and a prefix term built from the last word. The SQL is `websearch_to_tsquery(head) && (websearch_to_tsquery(last) || to_tsquery(prefix))`. Both parts go in as bound parameters through drizzle's `sql`. The prefix term is rebuilt from letters and digits only (`[\p{L}\p{N}]+` pieces joined with ` & `, then `:*`), so no tsquery operator can reach `to_tsquery`. There's no prefix after a trailing space, inside an open quote, on a `-word`, or on a bare `or`. Titles go through the same query. New PGlite tests:
  - "q" through "query" (and "QUE") find "Query selection" with "Query" highlighted. "que sel" needs "que" as a whole word.
  - `"tubeless tyres"` and `bike -gravel` keep their meaning, and so does `-gravel bik`.
  - Fifteen injection-shaped inputs (`'); drop table …`, `fir:* | x`, `<->`, `&`, `:*`, `"`, …) all return `ok`. `fir:*|!` searches as `fir:*`.
- **No flashing** (`use-palette-search.ts`, `chats.ts`).
  - While a new search runs, the last answer's hits stay. `staleHitsFor` keeps a hit only while every typed word still starts a word of its title or snippet, and re-ranks the survivors locally.
  - A late answer for an old query is dropped. Nothing clears until the query is empty. A failed search keeps what's listed.
  - `showSearching` turns on after 300ms of searching. The palette shows it as a spinner in the input row, labelled "Searching messages…". It's no longer a row in the list.
  - The "Chats" group renders only with chats in it.
- **Selection** (`command-palette.tsx`). cmdk's `value`/`onValueChange` are now controlled (cmdk 1.1.1).
  - The first enabled item is selected whenever the query changes or results arrive.
  - Once the person moves the selection, it stays where they put it while that item is listed. A move is a cmdk navigation key (↑ ↓ Home End ⌃N/P/J/K) or a pointer move, seen in capture.
  - cmdk's own automatic picks are ignored.
- **Tests.**
  - `packages/db` search: 4 new tests.
  - `packages/palette`: 16 → 25 tests, all new for this ticket.
    - `staleHitsFor` (3).
    - The hook (3): stale-while-revalidate across que→quer→query→queryx→q→"", a failure keeping the list, and the 300ms indicator.
    - The palette (3): no empty Chats group with the spinner outside the list; the selection rule with a chat landing between a moved selection and its old top; Enter opening a server-found chat above Ask AI.
  - `e2e/tests/palette.spec.ts` (Ben's account). It records every animation frame while typing "que", then "tz", then backspacing twice. It asserts that no frame has an empty group, and that the chat never leaves the list once it has appeared. Then Enter opens it. It fails on `main` (no match for "que") and passes here.
- **Verify.** Gate 82/82. `bun turbo test:e2e` 55/55 on port 3206.
- **Probe.** Before this change, the loop's probe on `main` showed an empty "Chats" heading (`groups=Chats|Ask AI items=1`) on every key of "quexyz". With a message-only match (title "Untitled chat" or "Topic Notes on the"), the hit appeared at "query", vanished at "quer" and "que", and the selection stayed on "Ask AI". After the change there are no empty groups. The message hit stays while backspacing to "que" and is selected. "quex" drops it at once without waiting for the server. Fast typing (90ms per key, debounce 150ms) still searches once at the pause; the e2e test covers "que" found by the server.
