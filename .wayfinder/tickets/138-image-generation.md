---
id: "138"
title: "Image generation in chat: generate_image tool, image models from config/gateway, saved to files and Artifacts"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02): "does the gateway etc. have image models? I'm surprised they're not coming through." They're filtered out on purpose (`packages/ai/src/providers/catalog.ts` `CHAT_TYPES`), because nothing in the app generates images. Then: "it would make sense to be able to generate an image into the chat; perhaps this would save in the file browser / artefacts list."

## Done when

- **Image models:** configured or discovered as their own list. `models.image` in config: a default image model plus optional discovery of `image`-type models from the gateway or other providers. They never appear in the chat model picker.
- **`generate_image` tool** in the registry (AI SDK `generateImage`): prompt, size or aspect, count ≤ 4, and an optional source image for edits where the model supports it. `approval: "ask"` by default, because image calls cost more; config can set it to `auto`. Plan mode withholds it.
- **Results:**
  - Each image is saved as a file in the chat's workspace (e.g. `images/<slug>.png`), so it shows in the file browser.
  - It's also saved as an image artifact, so it shows in the Artifacts list and page.
  - It's shown inline in the reply, with download and "Edit this image" (a follow-up prompt using it as the source).
- **Budget:** cost is recorded per image if `models.prices` covers it, and budgets apply.
- **+ menu (optional):** an "Image" entry that nudges the turn toward generating, like web search.
- **Model picker hover preview** (Connor, 2026-10-02: "we'd also update the chat hover preview in the model picker"): the card says "Sees images" (vision) and "Makes images", naming the image model `generate_image` would use ("with GPT Image"), or "itself" when the provider says the chat model outputs images natively. Localised, token colours, icons from `@workspace/icons`; the card keeps its size and place. Unit test and an e2e check.
- **Contract:** prefer existing message file parts and artifact shapes. If an image artifact kind or part is needed, it goes in its own `contract:` commit, additive, and awaits Connor's approval.
- **Tests:** a mock image model (no spend), unit and server tests, e2e (ask → approve → image inline, in Files and in Artifacts; Edit this image), and an eval case. Gate passes.

## Results (2026-10-02, loop)

Built on `t/138-image-generation` (8 commits, not pushed). Every Done-when item is in, and so is the picker hover preview Connor added. The contract change is its own first commit and **awaits Connor's approval**.

- **Contract** (`6007d8c`, additive only):
  - `artifactKindSchema` gains `image`.
  - `modelCapabilitySchema` gains `image-output`.
  - `ModelOption` gains an optional `imageModel { displayName, target }`.
  - `openapi.json` is regenerated.
  - The DB `artifact_kind` check needs a matching migration, `image_artifacts`.
- **Config** (`models.image`):
  - `default` is a ref; `models` lists more refs; `discover` is off by default.
  - `approval` is `ask` by default, or `auto`.
  - `models.prices` entries take `imageMicros`, a per-image price. `imageCost` adds that to any token cost the provider reports.
- **Discovery:**
  - The catalog keeps image models apart as `kind: image`. That covers the gateway's `type: image`, plus `gpt-image-*`, `dall-e-*` and `imagen-*` from OpenAI's and Google's untyped catalogs.
  - They never reach `listModels` or `checkModel`.
  - `imageModels(keys)` returns the default, then the configured models, then the discovered ones.
  - `imageModel(ref)` builds through the provider factory, so the gateway, OpenAI, Google, Azure and openai-compatible providers all work.
  - When a catalog says a chat model outputs images (OpenRouter `output_modalities`, gateway tag `image-generation`), that model gets `image-output`.
- **`generate_image`** (`packages/ai/src/tools/registry/generate-image.ts`, with the logic in `tools/image-generation.ts`):
  - Takes a prompt, a size or aspect ratio, a count of 1–4, and an optional `source` workspace path for edits. It calls AI SDK `generateImage`; an edit sends the source image as `prompt.images`.
  - Writes `images/<slug>-<n>.<ext>` without overwriting existing files, and saves each image as an `image` artifact whose version is a data: URL.
  - Records a `kind: tool` transaction priced from `models.prices`.
  - Checks for a spent hard budget before drawing anything.
  - The model is told where the images went and is not told what they show.
  - It is offered only when this context's keys can pay for an image model (D17). Plan mode withholds it.
  - An agent gets it when its version lists it, with `ask` as the default.
  - `TurnSandbox` gains `writeFile`.
- **Reply and UI:**
  - The status line reads "Wants to make 2 images", then each picture shows inline with Download and "Edit this image".
  - Pictures are served by `GET /api/artifacts/:id/versions/:versionId/image`: readers only, nosniff, and a CSP that allows nothing.
  - "Edit this image" fills the composer through a new `fill` prop: "Edit the image images/x.png: ".
  - The artifact panel and the Artifacts page show the picture with a download in place of its source.
  - The Files panel refreshes after a call.
  - The + menu has "Image", shown when the chosen model can make one. It starts the message with "Make an image of ".
  - The picker's preview card shows "Sees images" (renamed from Vision) and "Makes images" with "with Pixel", "itself", or "itself, or with …".
- **Tests (no real image API is ever called):**
  - The mock image model (`@workspace/ai/testing/mock-image-model`) and the mock-llm's `/images/generations` and `/images/edits` endpoints both return a 1×1 PNG.
  - Unit tests cover ai (12 image-generation, 7 registry-images), config (prices and schema), artifacts-kit, chat-ui (tool part, workspace) and composer (fill, the + menu, picker preview).
  - Server: `images.runs.test.ts` (5) checks ask then approve, files, artifacts, cost, auto, not offered, plan mode and budget. `artifact-images.test.ts` (3) covers the route.
  - Both golden snapshots gain the tool. The only other change is the image kind appearing in artifact output schemas.
  - e2e `images.spec.ts` (2) passes: ask, approval card, approve, two images inline, in Files under `images/`, in the Artifacts list and page, then Edit this image and the edit lands. It also checks the picker card's position and width, and the + menu.
  - One new eval case in `suites/tools.ts`. `evals --strict` passes.

Open for Connor:
1. Approve the contract commit.
2. Should `generate_image` take a `model` argument so the list can be chosen per call? Today the first usable image model is used.
3. Should the composer get a per-turn image model picker?
4. Should a run option force image generation, the way web search can be forced? That would be a contract change. The + menu only starts the text today.

Rebased onto main (Sites #105, Documents #109, #110, icons, header buttons) after Connor approved the contract (2026-10-02):
- `ArtifactKind` is now `…, site, document, image`.
- The migration was regenerated as `20261002073832_image_artifacts` after `documents`. Its check lists all nine kinds.
- The image kind has no instructions, so the kinds layer adds nothing and planning gets nothing from it.
- The image preview and download live in the Documents-era panel.
- The goldens only gain `image` in the artifact tools' output enums. The tool golden also gains `generate_image`.

Verification, all passing:
- `check` and `check:guards` on every commit.
- `bun turbo typecheck lint test build --continue`: 92 of 93. The one failure was the composer fill test racing TipTap's deferred focus; it's fixed and re-run.
- `evals --strict`.
- Full e2e on port 3310: 109 passed.
