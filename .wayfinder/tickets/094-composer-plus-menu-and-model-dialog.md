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
