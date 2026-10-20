# Chat

A user types in the composer on a new chat and sends with Enter. The reply
streams in, the chat gets its own `/c/<id>` address and a generated title,
and the conversation survives a reload and takes further turns.

## Sub-features

- `chat-new`: `/` shows `What can I help with?` and a centred composer.
- `chat-send`: Enter sends, and the assistant reply streams in.
- `chat-title`: a background job titles the chat. The title shows in the
  sidebar and header without a reload.
- `chat-reload`: after a reload the messages are still there, and a second
  turn works.

## How to get to it (user POV)

- Open `/`, the new-chat home.
- Choose `New chat` in the sidebar, or press `N` with focus outside a text
  field.
- Open an existing chat from the sidebar and type in its composer.

## Driving it with verify-web

Preconditions:

- Healthy instance, with the `accounts` journey done (signed in as Ada).

- **New chat.** Open `/`. Run `scripts/journey.sh chat`. `What can I help
  with?` is visible. Proof: `chat/01-new-chat`.
- **Send.** Type `Hello <tag> alpha` in `textbox "Message"` and press Enter
  (`send()`). The last `.is-assistant[data-message-id]` contains
  `Echo: Hello <tag> alpha`, and the URL matches `/c/<uuid>`. Proof:
  `chat/02-first-reply`.
- **Title.** The `Chats` panel has a row for `Topic Hello <tag> alpha`
  (`chatRow()` from `journeys/handles.ts`).
- **Reload and second turn.** Reload. There is 1 user and 1 assistant
  message. Send `And a second turn`, and the reply contains
  `Echo: And a second turn`, making 2 assistant messages. The read-back
  `conversations.get({ id }).title` equals the title. Proof:
  `chat/03-after-reload-second-turn.{png,aria.txt,json}`.

## Gotchas

- The server first renders a look-alike composer shell, and the editor
  replaces it. Wait for `composerReady()` (the `composer:ready` mark) before
  typing.
- Enter sends only when `Send` is enabled. While a reply is ending, `Stop`
  replaces it. `send()` waits for this.
- Titles are `Topic` plus the first three words of the first message (the
  mock's rule). A message whose first three words repeat an earlier chat's
  gives a duplicate title.
- `launch.sh` warms the chat route in dev mode. Without that warm-up the
  first visit to `/c/<id>` compiles for 30 s or more.
- A new chat's row can show under `Priority` with `Unread` added to its
  accessible name. Match rows with `chatRow()`, never an exact name.
- The first model turn on a fresh dev instance loads server code cold:
  `POST /api/runs` took 9 s and the first stream 13 s on 2026-10-21 under
  load, so the reply can miss `expectReply`'s 30 s and the assistant message
  reads `Still working on this answer…`. Check `server.log` for those two
  lines. If the run finished there, rerun the journey on the same instance
  and report the cold start. Keep other heavy jobs off the machine during a
  proof run.
