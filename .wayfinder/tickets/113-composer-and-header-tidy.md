---
id: "113"
title: "Composer and header tidy: model then level, no Default, no icons, context out of the way, sidebar toggle in the sidebar"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Connor (2026-10-01), looking at the local app:
- "make it model - then the variant - dont include a default option - just show medium etc. or whatever it is. also no need to show a brain"
- "maybe remove the provider icon from the picker in the composer - just to simplify it"
- "we should come up with a better place for the personal / organisation dropdown - that's only relevant to if you're in a project or something right? I feel like that shouldn't really be that present"
- "put the expand / collapse sidebar icon in the actual sidebar when opened - not in the header - only when collapsed should it go in the header - also remove the border at the bottom of the chat header - and lose the new chat button in the header when the sidebar is closed"

## Done when

- **Composer footer order:** + menu (and chips) at the start; then **model trigger, then the thinking level**, then Send.
  - The model trigger shows the name only, with no provider mark.
  - The thinking control has no brain icon; it shows the level as a word ("Medium").
- **No "Default" level.** The control shows the level the model will actually use: the provider's real default for that model when nothing is chosen. Look it up in the installed AI SDK providers and the providers' docs (e.g. Anthropic models without adaptive thinking default to Off; OpenAI reasoning models default to Medium). Put it in `packages/ai/src/providers/reasoning.ts`'s table next to the levels.
  - If a model's default can't be established, show the closest level the provider documents, and say in the report which ones are uncertain.
  - Choosing the default level sends nothing (`reasoning` absent), so behaviour doesn't change for people who never touch it.
- **Personal / Team / Org context** leaves the composer.
  - It becomes a quiet control in the chat header next to the title, shown only when the person belongs to a team or org; locked chats show it as text.
  - A person with only a personal context never sees it.
  - New chats keep today's default context.
- **Sidebar toggle:**
  - With the sidebar open, it sits in the sidebar's own header row (right side, next to the brand).
  - With the sidebar collapsed, it sits at the start of the chat header.
  - The header's New chat button is removed in both states (⌘/N and the sidebar's New chat remain).
- **Chat header** has no bottom border.
- **Tests:** composer and shell tests and e2e selectors updated, each change listed. Gate (including `evals --strict`) and e2e pass. No `packages/contract` change.

## Owns

`packages/composer/src/**`, `packages/ai/src/providers/reasoning.ts` (default levels), `packages/chat-ui/src/{chat,shell,sidebar}/**` (header, toggle, context control), `packages/ui/src/components/ai-elements/model-selector.tsx`, `packages/i18n/locales/**`, `e2e/**` (selectors).

## Results (2026-10-01, loop)

Built on `t/112-picker-position` (after 112's two commits), not pushed.

- **Composer footer** (`packages/composer`): + menu and chips at the start; then the model trigger (name only, no provider mark or icon), the thinking level (a word, no brain icon), Send.
- **No Default level.** `defaultReasoningLevel` in `packages/ai/src/providers/reasoning.ts` gives each reasoning model's level with nothing sent, always one of `reasoningLevels`. The control shows it when nothing is chosen; choosing it sends no `reasoning`. A choice remembered as `default` reads as none.
  - Anthropic: Off; Opus 5.5 Medium (SDK docs: effort defaults to medium); Fable 5 and 5.1 High (always think; effort defaults to high); Sonnet 5 High (the SDK notes it thinks by default).
  - OpenAI: Medium (SDK docs); GPT-5.1 and GPT-5.2 Off (OpenAI documents `none` as their default); their Codex models Medium.
  - Google: Gemini 3 High; Gemini 2.5 Medium (dynamic thinking, nearest level); 2.5 Flash-Lite Off.
  - DeepSeek High; anyone else Medium (OpenAI's `reasoning_effort` convention).
  - Uncertain: Sonnet 5 and Fable 5/5.1 (effort level inferred from "high for most models"), GPT-5.1/5.2 (from OpenAI's docs, not the SDK's), GPT-6 family (SDK's general "medium"), Gemini 2.5's dynamic budget, DeepSeek, and the catch-all.
- **Chat context** leaves the composer for a quiet control beside the chat title (`packages/chat-ui/src/header/context-control.tsx`): a menu until the first message, text with a lock after; shown only when the person has a team or org (or the chat is in one). It's gone from the Share and overflow menus. New chats still start Personal.
- **Sidebar toggle** (`shell/sidebar-toggle.tsx`): in the sidebar's top row while it's docked; at the start of the header when it isn't (collapsed, squeezed out by the panel, a phone's sheet). The header's New chat is gone. Same in the library/settings/admin shell (`apps/web/app/(app)/(pages)/page-shell.tsx`).
- **Header**: no bottom border (`AppHeader`, so every page).
- **Outside Owns:** `apps/web/app/dev/composer/demo.tsx` (dropped the composer's context props, which no longer exist) and `page-shell.tsx`/its test (so the other pages match). `packages/composer/README.md` updated.
- **Tests:** composer (order, Medium default and sends nothing, remembered level now Low, context tests removed), variants (no `default` level, `default: true` marker, old stored `default` parses), reasoning (default per provider), chat-screen (three header controls, toggle in the sidebar while open, context in the header as a menu or locked text, hidden for Personal only, gone from Share/overflow), page-shell. e2e: `contextChip` → `contextControl` in the header, `lockedContext` → locked header text; composer spec expects model, level, Send with Echo at Medium and GPT-5.2 at Off; shell spec checks no header border, no New chat, toggle in the sidebar.
- **Verified:** gate 85/85, `evals --strict: ok`; e2e 70 passed on port 3272. Screenshots (light/dark, 1440 and 375) in `/private/tmp/claude-501/113-screens/`.

## Resolution (2026-10-01, loop)

Merged with 112 as [PR #88](https://github.com/connorwforsyth/openchat/pull/88): gate 85/85, evals --strict ok, e2e 70/70.
