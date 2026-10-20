# Sidebar

The `Chats` panel beside the rail lists the user's conversations by title,
in `Priority`, `Pinned` and `Chats` sections. A row opens its chat, keeps
its title across a reload, and the row's actions menu renames it in place.

## Sub-features

- `sidebar-list`: a new chat appears as a row named by its title.
- `sidebar-reload`: a full load of `/` right after the title arrives still
  shows the title.
- `sidebar-open`: choosing a row opens that chat.
- `sidebar-rename`: `Actions for <title>`, then `Rename`, edits the title
  inline, and Enter saves it.
- `sidebar-attention`: a chat that needs attention moves to `Priority`, and
  its row name gains a status (`Unread`, `Working`, `Waiting for your
  approval`, `The last run failed`). Not asserted by the journey.

## How to get to it (user POV)

- The `Chats` panel (`complementary "Chats"`) on any chat page. On other
  pages the rail's `Chats` button brings it back. See `rail.md`.
- Hover a row, choose its `Actions for <title>` button, then `Rename`.

## Driving it with verify-web

Preconditions:

- Healthy instance, with the `accounts` journey done.

- **Listed.** From `/`, send `Sidebar <tag> beta`. Run `scripts/journey.sh
  sidebar`. `chatRow(page, "Topic Sidebar <tag> beta")` is visible.
- **Reload.** Load `/` at once, with no proof step in between, and wait for
  `composerReady()`. The row still reads `Topic Sidebar <tag> beta`. Proof:
  `sidebar/01-listed-after-reload`.
- **Open from row.** Choose the row. The URL is `/c/<id>`, and the chat
  shows `Echo: Sidebar <tag> beta`. Proof: `sidebar/02-opened-from-row`.
- **Rename.** Hover the row, choose `Actions for Topic Sidebar <tag> beta`
  and then menu item `Rename`. `textbox "Chat title"` is focused. Select
  all, type `Renamed <tag>` and press Enter. A row `Renamed <tag>` shows, and
  the read-back `conversations.get({ id }).title` becomes it
  (poll: the rename is optimistic, so the row changes first). Proof:
  `sidebar/03-renamed.{png,aria.txt,json}`.

## Gotchas

- The actions button appears on hover. Hover the row before you click it.
- Match rows with `chatRow()` from `journeys/handles.ts`. A row in
  `Priority` is named `<title> Unread`, so an exact-name match misses it.
- Known failure until the fix for the persisted query cache merges
  (2026-10-21, about 1 reload in 4): the `Reload` step fails. The IndexedDB
  snapshot trails the cache by up to a second, and restored sidebar queries
  counted as fresh for 30 s, so the row is missing its title and nothing
  refetches it. Report the failure. Don't add a wait before the reload.
- At widths under 768px the panel is a closed drawer and the rail is
  hidden. The journey runs at desktop size.
