# @workspace/composer

The prompt composer (PLAN.md §6, D13, D17): a TipTap editor with `/` prompt
templates and `@` mentions, file attachments, the model/agent picker and the
chat context chip. It's standalone: data and callbacks come in as props (no
fetching, no server), so a chat, Quick AI or an agent's test chat can each
host it. It depends only on `@workspace/ui`, `@workspace/icons`,
`@workspace/i18n` and contract types.

```tsx
import { ComposerLoader } from "@workspace/composer/components/composer-loader";

<ComposerLoader
  agents={agents}              // LibraryItem-shaped: picker + @mentions
  models={models}              // meta.listModels output; Auto is always offered
  target={target} onTargetChange={setTarget}
  context={context} contexts={contextOptionsFromMe(me, allowed)}
  contextLocked={hasMessages} onContextChange={setContext}
  people={members}             // UserSummary[] for @mentions
  prompts={prompts}            // { id, name, description, definition: PromptDefinition }
  attachmentLimits={{ accept: ["image/*", ".pdf"], maxFiles: 10, maxFileSize: 25e6 }}
  status={status} onStop={stop}
  onSubmit={(value) => send(value)}   // ComposerValue, see src/schemas.ts
/>
```

`onSubmit` gets a `ComposerValue` (zod: `composerValueSchema`): trimmed
`text`, `mentions` as `{ kind, id, label, start, end }` tokens indexing into
`text`, `attachments` as `{ id, file: File }` for the host to upload, and the
`templateId` of the prompt it started from. Enter sends, Shift+Enter adds a
line, paste is plain text (pasted files become attachments).

## Layout

| Path | What |
|---|---|
| `src/schemas.ts` | Zod schemas for everything the composer takes and emits. |
| `src/doc.ts` | Pure: ProseMirror JSON to text + mention tokens, and text back to content. |
| `src/variables.ts` | Pure: parse and fill `{{variables}}` (a `Result` listing what's missing). |
| `src/attachments.ts`, `options.ts`, `mentions.ts`, `triggers.ts`, `value.ts` | Pure: file limits, picker groups and context options, suggestion ranking, menu keys, the submitted value. |
| `src/editor/extensions.ts` | The TipTap schema and plugins (lazy chunk only). |
| `src/components/composer-shell.tsx` | The static placeholder: same frame, textarea instead of the editor. |
| `src/components/composer-loader.tsx` | Shell first, then swaps in the editor. |
| `src/components/composer.tsx` | The editor composer (client-only). |

## Loading: composer first

The composer is the first thing someone uses on a chat page, so it's built
around "can you type yet?" (the way ChatGPT's ProseMirror composer boots):

1. `ComposerLoader` renders `ComposerShell` on the server and on first paint.
   The shell has no editor code: the same frame, footer and pickers, and a
   plain `<textarea>` with identical box metrics (`components/styles.ts`), so
   it takes typing immediately.
2. After hydration the loader `import()`s `components/composer.tsx`, which
   bundlers split into its own chunk with TipTap and ProseMirror.
3. When it arrives the editor replaces the shell, starting from whatever was
   typed, with the caret where it was and focus kept. Nothing moves: the
   swap produced no `layout-shift` entries on `/dev/composer`.
4. The editor marks `performance.mark("composer:ready")` once it's
   interactive.

A chunk that fails to load leaves the shell up with a message. `load` is a
prop, so tests (and hosts with their own policy) decide when it resolves.
Render `Composer` directly only in client-only trees (tests do).

## Suggestions

`/` and `@` use TipTap's Suggestion utility. `hooks/use-suggestion-menus.ts`
is the renderer: it mirrors the plugin state into React and answers its keys;
`SuggestionMenu` draws a listbox above the composer while focus stays in the
editor (`aria-activedescendant`). Choosing a template with variables opens
the variables form, then inserts the filled text.

## TipTap licence

Only TipTap's MIT open-source packages are used (`@tiptap/core`, `pm`,
`react`, `suggestion`, `extensions` and the `extension-*` packages listed in
`package.json`), with versions in the root catalog. Never add TipTap Pro,
paid or cloud extensions, or anything that needs a TipTap account.

## Tests

`bun run test` runs Vitest in headless Chromium (browser mode, Playwright
provider): pure helpers, plus Testing Library tests for submit, stop, the
slash menu, variable filling, mentions, paste, attachments, the pickers, and
the shell-to-editor handoff. Lingui macros compile through the Babel plugin
in `vitest.config.ts`.

## Styling note

Tailwind generates utilities only for files its `@source` lines cover, and
`packages/ui/src/styles/globals.css` covers apps and `packages/ui` but not
this package. Until it adds `@source "../../../composer/src"`, a host has to
generate them itself; `apps/web/app/dev/composer/composer.css` does that for
the demo.
