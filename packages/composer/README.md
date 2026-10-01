# @workspace/composer

The prompt composer (PLAN.md §6, D13, D17): a TipTap editor with `/` file
commands and prompt templates, `@` mentions of agents, people and workspace
files, file attachments, the model/agent picker and the chat context chip. It's standalone: data and callbacks come in as props (no
fetching, no server), so a chat, Quick AI or an agent's test chat can each
host it. It depends only on `@workspace/ui`, `@workspace/icons`,
`@workspace/i18n` and contract types.

```tsx
import { ComposerLoader } from "@workspace/composer/components/composer-loader";

<ComposerLoader
  agents={agents}              // LibraryItem-shaped: picker + @mentions
  models={models}              // meta.listModels output; Auto is always offered
  target={target} onTargetChange={setTarget}
  webSearch={on} onWebSearchChange={setOn}   // only where the instance has web search
  context={context} contexts={contextOptionsFromMe(me, allowed)}
  contextLocked={hasMessages} onContextChange={setContext}
  people={members}             // UserSummary[] for @mentions
  prompts={prompts}            // { id, name, description, definition: PromptDefinition }
  attachmentLimits={{ accept: ["image/*", ".pdf"], maxFiles: 10, maxFileSize: 25e6 }}
  files={["README.md", "src/app.ts"]}  // workspace paths for @ and /open
  commands={["new-file", "open", "preview"]}
  onCommand={(command, path) => run(command, path)}
  status={status} onStop={stop}
  onSubmit={(value) => send(value)}   // ComposerValue, see src/schemas.ts
/>
```

`onSubmit` gets a `ComposerValue` (zod: `composerValueSchema`): trimmed
`text`, `mentions` as tokens indexing into `text` (`{ kind, id, label,
start, end }` for agents and people, `{ kind: "file", path, label, start,
end }` for files), `attachments` as `{ id, file: File }` for the host to
upload, and the `templateId` of the prompt it started from. Enter sends,
Shift+Enter adds a line, paste is plain text (pasted files become
attachments).

## Workspace files

The composer knows nothing about workspaces; the host passes paths and
command names in and gets tokens and calls out.

- `files` are workspace-relative paths (`src/app.ts`, no leading `/`).
  `@` offers them after agents and people (name first, folder as the hint),
  and a chosen file is a `{ kind: "file", path }` mention. The text reads
  `@app.ts`, so the host adds the path to the message itself (the chat sends
  a `data-workspace-file` part).
- `commands` lists the file commands `/` offers ahead of the prompts, always
  in the order `new-file`, `open`, `preview`. Choosing one removes the
  `/query` text and calls `onCommand(command)`. `/open` first lists `files`
  (typing filters them) and calls `onCommand("open", path)`; with no `files`
  it calls `onCommand("open")` at once. Leave `commands` out and `/` lists
  prompts only.

## Bottom row

The **+** menu and the model/agent picker sit at the start; the chat context
chip (only while `contextLocked` is false: after the first message the chat
shows its context elsewhere) and the round Send or Stop button at the end.

The + menu (`components/plus-menu.tsx`) holds what can be added to the next
message: *Attach files*; *Add a workspace file* (the `files` `/open` lists;
choosing one inserts the same `@file` mention `@` does) and *Use a prompt*
(the `prompts` `/` offers, variables form included), each only when there
are some; and *Web search*, a switch, only when the host passes
`onWebSearchChange` (the chat does when `features.webSearch` is on, and sends
`options.webSearch: "on"` for turns while it's on). While it's on, a
*Search* chip beside + turns it off. Skills join the menu once they run in
chats (082).

The picker (`components/target-picker.tsx`) is a search dialog, AI
Elements' model selector: sections for Auto, each provider's models (the
vendor after a gateway's colon, `gateway:anthropic/…` is Anthropic), then
agents by where they come from, with a divider between sections. Typing
matches every word against label, alias, ref and provider
(`filterTargetGroups` in `options.ts`); nothing is capped. An alias shows the
model id it stands for; an option without a key stays, disabled, saying so.
A second line shows a description when an option has one; only Auto does
until `ModelOption` carries them (096).

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
| `src/components/plus-menu.tsx`, `target-picker.tsx` | The + menu and the model/agent dialog. |

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
the variables form, then inserts the filled text. While TipTap loads a new
query's items it reports none; the renderer keeps the last list meanwhile,
so an Enter typed in that moment chooses rather than sends.

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

Tailwind generates utilities only for files its `@source` lines cover.
`packages/ui/src/styles/globals.css` scans every workspace package's `src`
(`@source "../../../*/src/**/*.{ts,tsx}"`), so any app that imports
`@workspace/ui/globals.css` gets the composer's styles with no extra CSS.
