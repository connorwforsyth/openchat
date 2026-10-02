---
id: "138"
title: "Image generation in chat: generate_image tool, image models from config/gateway, saved to files and Artifacts"
labels: [wayfinder:build]
status: in-progress
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
- **Contract:** prefer existing message file parts and artifact shapes. If an image artifact kind or part is needed, it goes in its own `contract:` commit, additive, and awaits Connor's approval.
- **Tests:** a mock image model (no spend), unit and server tests, e2e (ask → approve → image inline, in Files and in Artifacts; Edit this image), and an eval case. Gate passes.
