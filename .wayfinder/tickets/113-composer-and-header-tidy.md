---
id: "113"
title: "Composer and header tidy: model then level, no Default, no icons, context out of the way, sidebar toggle in the sidebar"
labels: [wayfinder:build]
status: open
assignee: loop
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
