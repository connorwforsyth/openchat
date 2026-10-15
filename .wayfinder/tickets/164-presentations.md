---
id: "164"
title: "Presentations: a `presentation` kind on `@workspace/slide-ui`, with present mode and PowerPoint export"
labels: [wayfinder:build]
status: open
assignee: loop
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

## Results (2026-10-16)

Built on branch `t/164-presentations`; no contract change.

- **Kind** (`packages/artifacts-kit/src/kinds/presentation/`): content is JSON `{ title, slides: [{ id, source, notes? }] }` (`content.ts`). Operations `add_slide`, `update_slide`, `move_slide`, `delete_slide`, `replace` (`operations.ts`); their `problems` name unknown ids (listing the deck's ids), a repeated id, a position out of range, and deleting the only slide. Checks (`slides.ts`): 1–60 slides, unique ids, 400k chars, and per slide imports only `react` / `@workspace/slide-ui`, known component names (`SLIDE_UI_EXPORTS`, kept equal to the package's exports by slide-ui's test), no whole-module import, a default export. Capabilities `present` and `annotate`; exports json (the Code tab's file), pptx, pdf; starter `{ badge: "new" }`; thumbnail `runtime`. The instructions carry the slide-authoring guide (canvas, type scale, palette, layout, pictures, steps), loaded via `load_artifact_guide` like sites. 162's placeholder for presentation is gone; diagram and spreadsheet stay.
- **update_artifact** (`packages/ai`): the flat `edit` object gains `slide`, `source`, `notes`, `index`; `operation` is the union of the document and presentation edits. `create_artifact` now offers `presentation`. Golden snapshots (artifact, sandbox tool, server instructions) updated.
- **`packages/slide-ui`**: layouts `Title`, `Section`, `Bullets`, `TwoColumn`, `Quote`, `Stat`, `ImageSlide`, `Agenda`, `Closing`, plus `Slide` (blank canvas), `Step`, `Notes`, `Logo`. Inline styles on theme CSS variables and a fixed scale (`./scale`), since the runtime page has no Tailwind. Browser-mode tests.
- **Runtime** (`apps/artifacts`): `presentation` renderer on the main page. Slides compile with `compileArtifact`/`evaluateArtifact` (which now takes the permitted set) against a table with slide-ui, stamped `data-src="slides/<id>.tsx:<line>"`; each slide is its own React root so one broken slide doesn't take the deck. Theme tokens come from globals.css (light or dark). Overview scales every slide to width; presenting fits one to the window with `[data-step]` reveals; nothing animates.
- **Protocol** (`chat-ui/artifacts/runtime-protocol.tsx`, not `packages/contract`): host `present` (enter/exit/next/previous/first/last) and `export` (pptx/pdf); frame `position` (slide, steps, notes), `exported` (bytes), `export-failed`.
- **Export**: the runtime redraws every slide at full size off screen, walks the DOM into a serialisable layout tree (`slide-layout.ts`, `slide-capture.ts`), and pure mappings (`pptxOps`, `pdfOps` in `slide-export.ts`) turn it into native shapes/text boxes/pictures via pptxgenjs and jsPDF (both MIT), with speaker notes in the pptx. The bytes go back to the panel, which downloads them (the sandbox can't).
- **Panel** (`presentation-preview.tsx`): Present (full window, plus browser full screen where allowed), arrows/Space/PageUp/PageDown/Home/End, N toggles notes, Escape exits; Export menu. The Artifacts page starter card reads "Slides" with the New badge.
- **Tests**: kit operations and checks; update_artifact slide edits; runtime loading, step navigation, notes, theme CSS; a .pptx round trip (JSZip: slide count, text runs, notes, media) and PDF page count; slide-ui browser tests; panel browser tests (present keys, notes, export download); `e2e/tests/presentations.spec.ts` (create, `move_slide`, present mode with steps and notes, .pptx download) passes locally.

Gaps:
- **Thumbnail**: declared `runtime`, but 161's gap stands (no thumbnail route without a contract change), so the grid shows the icon.
- **PDF** is drawn by jsPDF from the layout tree with Helvetica, not from browser print pages: the sandboxed frame can't open a print dialog, and printing on the app's origin would run model code there. Text, boxes and pictures carry over; web fonts, gradients, shadows and transforms don't. The same limits apply to the pptx.
- Pictures must be `data:` URLs or inline SVG (the runtime CSP blocks the network); SVGs are rasterised to PNG for export.
- No inspector comments yet; Annotate's `data-src` stamps are there for when it lands.
