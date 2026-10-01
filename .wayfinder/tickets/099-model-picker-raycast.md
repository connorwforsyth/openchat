---
id: "099"
title: "Model picker: brand logos, bare names, and a preview card with each model's details"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["096"]
---

## Question

Connor (2026-10-01) shared a recording of Raycast AI's model picker as the target, and asked for model logos, names without the vendor prefix (the section already says it), the provider on the right of each row, and the hover preview with the model's metadata, built as a component in our own UI kit.

What the recording shows:
- **A floating panel anchored above the composer** (not a modal), with "Search models…" and an info button.
- **Sections:** Recently used, then one per provider, with a divider between them.
- **Each row:** the provider's logo, the bare model name ("Claude Opus 5", not `anthropic/claude-opus-5`), and the provider muted on the right.
- **A preview card beside the panel** that follows the highlighted row (pointer or arrow keys), showing:
  - the name;
  - Speed, Intelligence and Cost as segmented bars;
  - Context ("150k words | 200k");
  - capabilities with icons: Vision, Tool Use, Supports Reasoning, or a muted "Reasoning unsupported".
  - Provider-setup rows show a sentence instead. A model with no data says so ("No benchmarks for …").

Connor approved (2026-10-01):
- **Contract:** additive optional fields on `ModelOption` for the card.
- **Logos:** vendored monochrome SVG brand marks in `@workspace/icons`, from an MIT-licensed set.

## Done when

- **Contract** (`packages/contract/src/schemas/models.ts`, additive, all optional):
  - `displayName` (the catalog's human name, else derived);
  - `capabilities`, extended or confirmed to cover `vision`, `tools`, `reasoning`;
  - `cost` (a 1–5 tier and, when the price table or catalog knows it, input/output micro-USD per million);
  - `ratings` (`speed`, `intelligence`, 1–5, only from config).
  - `contextWindow` already exists. Old clients keep working; the OpenAPI is regenerated.
- **Server** fills these from the provider catalog (095: name, context window, pricing, tags/capabilities where the catalog has them), the price table (`models.prices`, PR #71, if present on the branch; otherwise the catalog's pricing), provider capabilities, and a new optional config `models.ratings.<alias or ref>: { speed, intelligence }`. Nothing is invented: unknown means absent.
- **Logos:** vendor monochrome SVGs for at least Anthropic, OpenAI, Google, Meta, Mistral, xAI, DeepSeek, Qwen/Alibaba, Cohere, Amazon, Microsoft, Perplexity, Moonshot, Zhipu and NVIDIA. Use `currentColor`, keep the source's licence notice, no network at runtime. The existing letter mark stays as the fallback.
- **The picker** replaces the 094 dialog's presentation with an anchored panel (Base UI Popover + our cmdk `command.tsx`), opening above the trigger, keyboard-first. Escape returns focus.
  - **Sections:** Recently used (the last 3 the person picked, kept per user in local storage, with a fallback when unavailable), Auto if enabled, one per provider, then agents.
  - **Rows:** logo, `displayName` without the vendor prefix, the provider muted on the right; unavailable rows disabled with the reason; the description line from 096 kept.
- **Preview card** — a new reusable `PreviewPane` component in `packages/ui` (a side card anchored to the panel that follows the active item). Base UI's `PreviewCard` is hover-only, so the component tracks the command list's active value instead, so keyboard and pointer both drive it.
  - **Content:** the name; Speed, Intelligence and Cost as segmented 5-step bars (hidden when unknown); Context in words and tokens; Vision, Tool use and Reasoning rows (muted when unsupported); the description. Agents show their own description.
  - **Narrow widths:** under ~640px the card moves below the list instead of beside it.
- **Tests:** server fill and precedence, contract round trip, `PreviewPane` follows the active item by keyboard and pointer, rows show bare names and providers, logos resolve with a fallback. e2e: open, arrow down, the card shows the highlighted model's context; pick and send. Gate and e2e pass.

## Owns

`packages/contract/src/schemas/models.ts` (these fields only), `packages/ai/src/providers/**`, `packages/config/src/schema.ts` (`models.ratings`), `packages/server/src/api/meta.ts`, `packages/icons/**`, `packages/ui/src/components/**` (new `preview-pane`, the vendored model selector), `packages/composer/src/**`, `docs/self-hosting.md`, `e2e/tests/composer.spec.ts`, `e2e/support/**`.

## Results (2026-10-01, loop)

Built on `t/099-model-picker` (from `t/096-model-descriptions`). Not pushed.

- **Contract (additive, approved).** `ModelOption` gains optional `displayName`, `cost` (`{ tier: 1–5, input?, output? }`, prices in micro-USD per million tokens) and `ratings` (`{ speed?, intelligence? }`, 1–5), with helper schemas `modelTierSchema`, `modelCostSchema`, `modelRatingsSchema`. `capabilities` already covered `vision`, `tools` and `reasoning`, so it's unchanged. `openapi.json` regenerated. Round-trip cases for the new schemas, a contract test that the 099 fields survive `meta.models`' output schema, and one that the 096 shape still parses.
- **Server** (`packages/ai/src/providers/{catalog,describe,registry}.ts`). The catalog parser keeps prices (gateway `pricing.input/output`, OpenRouter `prompt/completion`, USD per token; a negative price counts as unknown) and traits (gateway tags mean yes; OpenRouter's `supported_parameters` and `input_modalities` mean yes or no; Google's `thinking`). `listModels` fills:
  - `displayName`: the catalog's name, minus OpenRouter's `Vendor: ` prefix, else `tidyModelName(id)` ("Claude 3.5 Sonnet", "GPT-4o Mini", "Llama3.2 3B");
  - `cost`: from catalog prices only, tiered on a 3:1 blended price (≤$0.50, $2.50, $8, $20 per million tokens, then 5). There's no `models.prices` on this branch;
  - `ratings`: only from the new `models.ratings` config (alias beats ref, checked at boot, `auto` refused; `bun run setup` prunes stale entries the way it prunes descriptions);
  - `capabilities`: the provider's, minus anything the catalog denies, plus `reasoning` when the catalog confirms it. Vision and files are never added from a catalog, because the provider config decides whether images are sent.

  Nothing unknown is filled in. `meta.ts` needed no change.
- **Logos.** `@lobehub/icons-static-svg` 1.95.1 (MIT) is a devDependency of `packages/icons`, pinned in the root catalog. `bun run icons:generate` copies the monochrome paths of the marks listed in `src/brands/brands.ts` into the checked-in `src/brands/marks.generated.ts`. That list is the one place for vendor display names and marks: 34 ids, 26 marks. A fixed colour, gradient or stroke fails the generator. `brands.test.ts` fails when the generated file is stale against the installed package. `LICENSE` and `NOTICE` sit beside it. The marks are exposed as `@workspace/icons/brands` (`BrandMark`, `brandName`, `hasBrandMark`). Nothing reads the network or node_modules at runtime. To update: bump the catalog version, `bun install`, `bun run icons:generate`, review the diff.
- **PreviewPane** (`packages/ui/src/components/preview-pane.tsx`, README in `packages/ui/README.md`). It shows a side card for a list's active item, controlled or uncontrolled. `usePreviewPane().bind` wires any list that reports its active value (cmdk's `value`/`onValueChange`). The card sits beside the list from 640px and below it under 640px. `packages/ui` tests now run in Vitest browser mode.
- **Picker.** The vendored `model-selector.tsx` is now a Base UI Popover that opens above the trigger, with list and card laid out by `PreviewPane`. New parts: `ModelSelectorVendor` and `ModelSelectorPreview{Title,Meter,Row,Section,Note}`. The meter is drawn bars over an sr-only `<meter>`. `target-picker.tsx` has these sections:
  - **Recently used:** the last 3 picks, per `recentsKey` (the chat passes `me.user.id`), kept in memory when storage throws.
  - **Auto:** only when the server lists it.
  - **One section per vendor:** rows show logo, display name without the prefix, the vendor muted at the end, the 096 line, and disabled rows with their reason.
  - **Agents.**

  The card shows the name, Speed, Intelligence and Cost bars when known (otherwise "No ratings or prices for …"), Context in words and tokens, Vision, Tool use and Reasoning, and the description. An agent's card shows its own description.
- **Tests.**
  - icons: 95, of which `brands.test.ts` is 8.
  - contract: 1373.
  - ai: 361, of which `preview.test.ts` is 25.
  - server `meta.test.ts`: +1.
  - setup `plan.test.ts`: +1.
  - ui: 8, of which PreviewPane is 6.
  - composer: 118. The picker has 13, including logo fallback, bare names and vendors, card by keyboard and pointer, recents, and blocked storage.

  e2e `composer.spec.ts` gains a test: open the picker, the card shows Echo's 128K context, ArrowDown moves the card to Parrot's, Enter picks it and sends with target `mock:parrot`, and the next opening lists Parrot under Recently used. The e2e mock provider now uses `discover: true`, and its `/models` names and prices `echo` and adds `parrot`.
- **Verified.** `gate.sh` 82/82. `E2E_PORT=3202 bun turbo test:e2e`: 56 passed and 1 failed, `memory.spec` "nothing is saved from a shared chat" (known to fail under load); it passes on its own, so 57/57. Screenshots (not committed) are in `/private/tmp/claude-501/099-screens/`: light and dark at full and partial data, an agent, the letter mark with a disabled row, and 375px. They were taken from `/dev/composer` with a temporary richer model list, since reverted.
- **Outside Owns, needed:** `packages/chat-ui/src/chat/connected-chat.tsx` (one line: `recentsKey: me.user.id`), `packages/setup/src/config-file.ts` (prunes stale ratings), root `package.json` catalog and `bun.lock`, and `packages/i18n` catalog.

Open:
- "Reasoning unsupported" can't be shown truthfully. `capabilities` lists only what's supported, and a missing entry can just mean nobody said. The server knows when a catalog denies reasoning, but the contract has nowhere to put it. An optional `unsupported` list (or similar) would need approval; `ModelSelectorPreviewRow` already has a `muted` style for it.
- Google maps to the Gemini sparkle rather than the "G". It's one line in `brands.ts`.
- Picker search doesn't match the vendor display names of vendors listed only by id (e.g. `meta-llama` and `meta` are separate groups). This is unchanged from 096.

## Resolution (2026-10-01, loop)

Merged on Connor's go-ahead ("happy to start merging"), after a rebase and the full local gate (incl. `evals --strict`) and e2e on the rebased branch. [PR #81](https://github.com/connorwforsyth/openchat/pull/81).
