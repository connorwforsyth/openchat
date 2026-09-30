---
id: "094"
title: "Composer: a + menu, and a searchable model dialog grouped by provider"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor asked (2026-10-01) for two composer changes. (1) The Attach button becomes a **+** menu with a few options: attachments, and later the list of skills. (2) The model/agent picker becomes a search dialog, as AI Elements' model selector does, with every option searchable, grouped with dividers, and room for a short description under each. The model list itself grows in [095](095-model-discovery.md); descriptions need a contract field and wait for Connor ([096](096-model-descriptions.md)).

## Done when

- **+ menu** replaces the Attach button in `composer-footer.tsx`: *Attach files* (today's behaviour), *Add a workspace file* (the same list `/open` shows, when the chat has a workspace), *Use a prompt* (the prompts `/` offers), and *Web search* as a toggle when the instance has web search (it sends the existing `options.webSearch`). No *Skills* item yet: skills don't run in chats until S4 (082); leave a clear place for it. Keyboard: opens from its button, arrow keys, Escape returns focus to the button.
- **Model dialog** replaces the dropdown in `target-picker.tsx`: a trigger showing the current choice (provider logo + name), opening a Dialog with a Command list (vendor AI Elements' `model-selector` into `packages/ui/src/components/ai-elements/` if it fits our shadcn-on-Base-UI setup; otherwise build it from our `command.tsx` + dialog). Type-to-search across every model and agent (label, alias, ref, provider). Sections with headers and a divider between them: Auto, then one per provider (derived from the option's `target` ref, e.g. `gateway:anthropic/claude-haiku-4.5` → Anthropic; gateway refs use the vendor after the colon), then My agents / Shared agents as today. Each row: provider logo (monochrome, from our icon set or a small neutral fallback), the label, and the ref in muted text when the label is an alias; a second muted line for a description, rendered only when one exists (the field arrives with 096). Unavailable options stay visible and disabled with the reason ("no key in this context"), as now.
- Works at 340px wide and on touch; Lingui strings extracted; no motion beyond the dialog's existing one.
- Component tests in `packages/composer`; e2e: open the dialog, search, pick a model by keyboard, send; the + menu attaches a file and toggles web search. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/composer/src/**`, `packages/ui/src/components/ai-elements/**` (a vendored model selector), `packages/icons/**` (provider marks), `packages/i18n/locales/**` (extracted strings), `e2e/tests/composer*.spec.ts`.

## Results (2026-10-01, loop)

Built on branch `t/094-composer-plus-menu` (not pushed).

- **+ menu** (`packages/composer/src/components/plus-menu.tsx`, on AI Elements' `PromptInputActionMenu*` over Base UI's menu) replaces the Attach button: *Attach files*; *Add a workspace file* (submenu of the files `/open` lists; inserts the same `@file` mention `@` does, so the chat sends it as a workspace-file part) and *Use a prompt* (submenu of the `/` prompts, variables form included), each only when there are some; a *Web search* checkbox only when the host passes `onWebSearchChange`. While it's on, a *Search* chip beside + turns it off (focus goes back to +). A comment marks where Skills go (082). Arrow keys, type-ahead, Escape back to the + button come from Base UI.
- **Web search wiring:** new composer props `webSearch` / `onWebSearchChange`. `packages/chat-ui/src/chat/connected-chat.tsx` (outside Owns: the Done-when needs a host to send it) offers the switch only when `config.features.webSearch`, and while it's on sends `options: { sandbox: "auto", webSearch: "on" }` on `POST /api/runs`; off sends no `options` (unchanged from before). No contract change.
- **Model dialog:** AI Elements' `model-selector` vendored to `packages/ui/src/components/ai-elements/model-selector.tsx` (MIT; on our Base UI dialog + cmdk command; letter marks instead of models.dev logos; README notes the changes). `target-picker.tsx` uses it: sections Auto → one per provider → My agents / Shared with me / Team & org agents, a divider between sections. Provider = the vendor before `/` in a ref's model id when there is one (`gateway:anthropic/…` → Anthropic), else the provider key; `providerLabel` names common vendors, others show as written. Search (`filterTargetGroups`, pure, in `options.ts`) matches every word, any order, across label, alias, ref and provider; no cap. Aliases show their model id muted; disabled rows say "No key in this context"; a second line renders only for a description (Auto's UI string for now, 096 for the rest). Opens on the current choice; Escape/choice returns focus to the trigger.
- **Tests:** composer vitest 85 → 101 (options +8, new `target-picker.test.tsx` 5, composer +4, two picker tests moved from menu radios to dialog options). E2E: new `e2e/tests/composer.spec.ts` (2: dialog search + keyboard pick + send with target checked on the request; + menu attach + keyboard web-search switch with `options.webSearch` checked on the request, and off again). Selectors changed: `e2e/support/chat.ts` `pickTarget` (dialog `option` instead of `menuitemradio`, plus new `plusMenu`/`openAttachChooser` helpers), `e2e/tests/context.spec.ts` (uses `pickTarget` instead of its own menu clicks), `e2e/tests/files.spec.ts` and `e2e/tests/workspace.spec.ts` (Attach via the + menu). `packages/composer/vitest.config.ts` pre-bundles `@base-ui/react/dialog` and `cmdk`.
- **Verified:** `gate.sh` 82/82; e2e 46 tests pass (in the full runs under load, `memory.spec` "shared chat" and `workspace.spec` per-hunk review each failed once and passed re-run alone; `composer.spec` passes 13/13 with `--repeat-each=6`). Screenshots (not committed) in `/private/tmp/claude-501/094-screens/` (before/after, light/dark, desktop/375).
- **Open:** real provider marks (needs brand SVGs Connor is happy to ship in `@workspace/icons`); whether the web-search switch should be off=`auto` (as built) or offer a forced `off`; whether it should reset per chat; `/dev/composer` doesn't show files or web search (apps/web isn't owned here).
