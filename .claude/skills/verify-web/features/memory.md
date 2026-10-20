# Memory

Telling the assistant to remember something updates the user's memory file.
A note in the chat says `Memory updated: …` and offers Undo. The memory
shows under Settings › Memory, and Undo reverts it.

## Sub-features

- `memory-save`: `remember <fact>` makes the model call `update_memory`,
  and the note appears.
- `memory-settings`: `/settings/memory` shows the saved fact.
- `memory-undo`: the note's `Undo` reverts the change.

## How to get to it (user POV)

- Type `remember …` in any chat's composer.
- Open Settings › Memory (`/settings/memory`).
- Choose `Undo` on the `Memory updated` note in the chat.

## Driving it with verify-web

Preconditions:

- Healthy instance, with the `accounts` journey done. Ada's memory is empty
  (the journey asserts this first).

- **Save.** From `/`, send `remember I prefer pnpm`. Run
  `scripts/journey.sh memory`. `[data-slot="memory-note"]` contains `Memory
  updated: Prefer pnpm`, and the reply contains `Tool result:`. The
  read-back `memory.get().content` contains `I prefer pnpm`. Proof:
  `memory/01-memory-updated.{png,aria.txt,json}`.
- **Settings view.** Open `/settings/memory`. It loads the full-screen
  `dialog "Settings"` over the new chat, and its `textbox "Memory"` holds
  `I prefer pnpm`. Proof: `memory/02-settings-memory`.
- **Undo.** Back on the chat, choose `Undo` in the note. The note reads
  `Memory change undone`, and `memory.get().content` no longer contains
  `pnpm`. Proof: `memory/03-undone.{png,aria.txt,json}`.

## Gotchas

- Settings › Memory can also show the latest change in a `<pre>`, so the
  fact's text appears twice. Assert on `textbox "Memory"`, not on the text.

- `remember …` triggers the tool only because the mock is steered by that
  prefix. A real model may phrase or decide differently.
- Nothing is saved from a shared chat (`e2e/tests/memory.spec.ts`). That
  path needs a second user and isn't in this journey.
- The journey requires empty memory at the start. If an earlier run failed
  before Undo, the precondition fails. Relaunch for a clean instance.
