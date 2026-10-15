---
id: "164"
title: "Presentations: a `presentation` kind on `@workspace/slide-ui`, with present mode and PowerPoint export"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["162"]
---

## Question

Connor (2026-10-16) wants a presentations mode, possibly modelled on open-slide (open-slide.dev, MIT): slides are arbitrary React components on a fixed 1920×1080 canvas, with steps, a present mode, an inspector whose comments the agent applies, and PPTX export in the browser. open-slide is a Vite-scaffolded workspace rather than a library to embed, so we take its model and build on our runtime. The kind's library is its own package, as with sites (163).

## Done when

- **Content (JSON):** `{ title, slides: [{ id, source, notes? }] }`. Each `source` is TSX that default-exports one slide.
  - Operations: `add_slide`, `update_slide`, `move_slide`, `delete_slide` and `replace`. Their `problems` cover an unknown slide id or a bad position.
  - Checks: imports only from `react` and `@workspace/slide-ui`, known component names, and a slide-count cap.
- **`packages/slide-ui`:** layouts `Title`, `Section`, `Bullets`, `TwoColumn`, `Quote`, `Stat`, `ImageSlide`, `Agenda` and `Closing`, plus primitives `Step` (revealed on advance), `Notes` and `Logo`.
  - It uses a fixed type scale and the theme tokens.
  - The guide follows open-slide's `slide-authoring` rules (canvas, type scale, palette, layout).
- **Runtime:** a `presentation` renderer on the runtime page, which already allows eval for React. It reuses `compileArtifact` and `evaluateArtifact`, with `@workspace/slide-ui` in the module table, and scales the canvas to fit. `data-src` annotate works as it does for React.
- **Present mode:** `capabilities.present` gives full screen, arrow keys to step and speaker notes. There's no animation for keyboard navigation (D28).
- **Export:**
  - `.pptx` via `pptxgenjs` (MIT). It walks each rendered slide's DOM into native text boxes, shapes and images.
  - `.pdf` from 1920×1080 print pages.
- **Artifacts page:** a "Slides" starter card (161), and the first slide as the thumbnail.
- **Tests:** kit tests for operations and checks, runtime tests, a `.pptx` round-trip (parse it back and count slides and text), browser-mode tests for slide-ui, and e2e covering create, a `move_slide` edit, present mode and the export download.

## Owns

`packages/slide-ui/**` (new), `packages/artifacts-kit/src/kinds/presentation/**`, `builtin.ts` and `instance.ts` (registration), `apps/artifacts/src/**` (the presentation renderer), the presentation viewer and present mode in `packages/chat-ui/src/artifacts/`, `e2e/tests/presentations.spec.ts`.
