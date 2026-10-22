# Command palette

⌘K (Ctrl+K elsewhere) opens a command palette from any signed-in page. It
searches chats by the words in their messages (server full-text search, by
word prefix), opens a hit with Enter, and runs actions such as `Open
settings`.

## Sub-features

- `palette-open`: the panel's `Search chats` button and ⌘K open it.
- `palette-chat-search`: a word prefix from a message finds the chat by its
  title.
- `palette-open-hit`: Enter on a hit opens `/c/<id>`.
- `palette-action`: `settings` lists `Open settings`, which opens the
  full-screen settings view at `/settings` over the current page. Escape
  closes it back to that page.

## How to get to it (user POV)

- Press `ControlOrMeta+K` anywhere in the app.
- Choose `Search chats` in the panel's `Primary` navigation.

## Driving it with verify-web

Preconditions:

- Healthy instance, with the `accounts` journey done.

- **Seed a chat.** From `/`, send `Palette <tag> quetzal sightings`. Run
  `scripts/journey.sh palette`. The header shows `Topic Palette <tag>
  quetzal`.
- **Open from the panel.** On `/`, after `composerReady()`, choose `Search
  chats` in `navigation "Primary"`. The input with placeholder `Search or
  type a command…` is visible.
- **Search.** Type `<tag>` (a prefix of a word in the message). `option
  "Topic Palette <tag> quetzal"` is visible. Proof: `palette/01-search-hit`.
- **Open hit.** Press Enter. The URL is `/c/<id>` of the seeded chat. Proof:
  `palette/02-opened-chat.{png,aria.txt,json}`.
- **Action.** Open it from the panel again, fill `settings`, and choose
  `option "Open settings"`. The URL matches `/settings` and `dialog
  "Settings"` is visible. Proof: `palette/03-action-open-settings`. Press
  Escape. The dialog is gone and the URL is `/c/<id>` again.
- **Shortcut.** A second test: on `/`, wait for `composerReady()` and
  network idle (the palette has loaded), press `ControlOrMeta+K` once. The
  palette opens and is still open a second later. Proof:
  `palette/04-shortcut-open`.

## Gotchas

- The palette loads after boot (after `composer:ready` on chat pages). An
  early ⌘K does nothing. Wait for network idle before pressing it.
- The `Shortcut` test guards a fixed bug (#171). Before it, one ⌘K on a
  chat screen opened the palette and closed it about 130 ms later, every
  run: two handlers answered `palette.open` there, chat-ui's `useShortcuts`
  in `chat-screen.tsx` (opens) and the palette's own `useShortcut`
  (toggles). On `/library`, which has no chat screen, it stayed open. If
  the test fails again, report it. Playwright's `Desktop Chrome` preset
  hides this bug: its Windows user agent makes the shortcuts package expect
  Ctrl, so only chat-ui answered ⌘ on a Mac. Don't switch the journey back
  to a device preset.
- Search matches word prefixes from the message body. Reruns need a fresh
  word, or two chats match and strict-mode locators fail.
