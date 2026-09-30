# AI Elements (Base UI)

Owned copies of the [AI Elements](https://ai-sdk.dev/elements) components that
shadcn has no equivalent for (PLAN.md D5). AI Elements ships Radix-only, so
these were installed with the shadcn CLI from `https://registry.ai-sdk.dev`
and hand-migrated to Base UI. They are source we maintain now, not a
dependency. `apps/web/app/dev/ai-elements` renders each one with static data.

## What's here, and why

| File | Why it's AI Elements and not shadcn |
|---|---|
| `message.tsx` | Streamdown markdown for model output (`MessageResponse`), branch paging (`MessageBranch*`), per-message actions. shadcn's `Message`/`Bubble` lay out a row but render no markdown and know nothing of branches. |
| `reasoning.tsx` | Collapsible thinking with stream timing and auto-close. No shadcn counterpart. |
| `tool.tsx` | Tool-call header, status badge, input and output, typed by the AI SDK's `ToolUIPart`. No shadcn counterpart. |
| `prompt-input.tsx` | The composer: attachments (picker, paste, drop, previews), IME-safe Enter, model select, dictation, submit/stop by `ChatStatus`. shadcn's `InputGroup` is the frame it's built on, not a composer. |
| `model-selector.tsx` | A searchable model dialog (Dialog + Command) with provider sections and marks; the composer's model/agent picker (094). shadcn has the parts, not the composition. |
| `streamdown.tsx` | Ours, not upstream: hands Streamdown the registry's icons (D19) and Lingui strings (D12). |

Deliberately **not** installed:

| AI Elements item | Instead |
|---|---|
| `conversation` | shadcn's `message-scroller` (`@workspace/ui/components/message-scroller`): stick-to-bottom, anchoring and jump-to-latest built in. |
| `code-block` | `@pierre/diffs` `CodeView` in `packages/code-ui` (D16). `tool.tsx` shows JSON in a plain `<pre>` until then; Streamdown renders fences without highlighting. |
| `shimmer` | shadcn's `shimmer` utility class (no `motion` dependency). |
| everything else (`artifact`, `sources`, `suggestion`, `file-tree`, …) | Pulled in by the ticket that needs it, after checking shadcn first. |

`prompt-input.tsx` also drops upstream's `PromptInputCommand*` wrappers: they
were thin re-exports of shadcn `command` (cmdk), whose dependency tree is
Radix. Slash commands and mentions belong to the composer work and should use
Base UI's `Combobox`/`Autocomplete`.

## How they were migrated

Each file was classified against its registry original and rewritten with the
`migrate-radix-to-base` skill's mappings. Supporting shadcn primitives came
from the `base-nova` registry, so they were Base UI already.

- `asChild` became `render` (tooltip, hover-card and dropdown triggers).
  `MessageAction` passes its button as the tooltip trigger's `render`, so it
  no longer nests a button in a button.
- Radix's `useControllableState` in `reasoning.tsx` became a
  five-line controlled/uncontrolled state; Base UI keeps its version internal.
- Collapsible `data-[state=open|closed]` height animations were dropped:
  panels open and close at once (D28 animates only transform and opacity);
  the tool chevron reads the trigger's `data-panel-open`.
- Hover-card delays moved from the root to the trigger
  (`PromptInputHoverCardTrigger`), where Base UI's `PreviewCard` keeps them.
- Menu item `onSelect` became `onClick`.
- Icons come from `@workspace/icons` (codemod, plus `CircleCheckIcon`/
  `CircleXIcon` for lucide's deprecated `CheckCircle`/`XCircle`, and the
  `ReasoningIcon`, `ToolIcon`, `AttachIcon` and `StopIcon` aliases).
- Every string goes through Lingui, including Streamdown's control labels.
  `Thought for N seconds` and `N of M` are ICU messages.
- Palette colours on tool status became semantic tokens; `ml-`/`mr-`/`right-`
  became logical utilities.
- Lint fixes (stable handlers, no nested promises, `interface` types) and the
  AI SDK 7 tool states (upstream still `@ts-expect-error`s them).

No Radix import or dependency remains in this package, and none reaches it
transitively (`bun.lock` has no Radix packages).

### `model-selector.tsx` (ticket 094)

Copied from `packages/elements/src/model-selector.tsx` (MIT) and adapted:

- Built on our Base UI `dialog` and the cmdk `command` already in this
  package; no new dependency.
- `ModelSelectorLogo` draws a neutral letter mark instead of loading
  `models.dev/logos/<provider>.svg`: the page never fetches from a third-party
  host, and `@workspace/icons` has no brand marks. `LogoGroup` targets the
  mark rather than `<img>`.
- `ModelSelectorContent` takes `command` props for the inner cmdk root (the
  composer filters for itself with `shouldFilter: false` and controls the
  highlighted row), a translated default title, no close button, and sits
  near the top of the screen like the command palette, so a phone keyboard
  doesn't cover the search field.
- `ModelSelectorItem` aligns to the top, for rows with a second line.
- `text-left` became `text-start`.

## Behaviour changes to know about

- Choosing "Add photos or files" now closes the action menu (Base UI's
  `closeOnClick` default). Upstream kept it open with `preventDefault`.
- `PromptInputSelect` shows the raw value unless the root gets `items`
  (Base UI's `Select.Value` renders labels from `items`). The demo passes them.
- Dictation uses the page's `lang` instead of a hard-coded `en-US`, and errors
  just stop listening instead of logging.
- `ReasoningContent` no longer spreads panel props onto `Streamdown` (an
  upstream slip).
- `PromptInputSubmit` is labelled "Stop" while streaming.

## Verify by hand (`/dev/ai-elements`)

1. Tab to the tool header, press Enter: the panel expands and the chevron
   flips; Enter again collapses it.
2. Hover and focus the copy and retry actions: tooltips appear; each is one
   button in the accessibility tree.
3. Page the answer branches with the arrows; "1 of 2" updates.
4. Open the reasoning block; it animates height, not just opacity.
5. Paste or drop an image into the composer; hover the chip for the preview
   card; Backspace in the empty textarea removes it.
6. Open the model select with the keyboard, pick with arrows and Enter.
7. Type with an IME (e.g. Japanese): Enter confirms the candidate and doesn't
   submit.

## Upstream

When vercel/ai-elements#450 (the Base UI variant) merges, diff it against
these files and adopt what it does better (D5). Keep the local changes listed
above.
