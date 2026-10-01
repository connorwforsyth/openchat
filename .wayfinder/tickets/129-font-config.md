---
id: "129"
title: "Swap interface fonts from app.config.yaml"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02): "i would also want some easy font swapping too", so he can try other fonts the way `icons: { set: phosphor }` swaps icons.

## Done when

- `fonts: { sans, mono }` in app.config.yaml picks from bundled fonts: sans is Geist (default), Inter, Open Sans, IBM Plex Sans, Figtree or Manrope; mono is Geist Mono (default) or JetBrains Mono.
- Fonts come from npm packages, so nothing is downloaded. They are compiled in the way icons are: `fonts:select` writes `lib/fonts.selected.ts` for just the chosen pair, so other fonts never ship. In dev a change applies on restart; an image needs a rebuild. The yaml is the only source; Connor doesn't want icon or font settings in `.env`.
- The schema test covers the defaults and rejects unknown fonts. Gate and e2e pass.

## Results (2026-10-02, loop)

- `packages/config` adds `fontsSchema`. `apps/web/lib/font-catalog.ts` lists the choices, and `apps/web/scripts/fonts-select.ts` (turbo `fonts:select`, run before dev, build and typecheck) writes the gitignored `lib/fonts.selected.ts`. The root layout imports `fontClasses` from it.
- Docs: a "Fonts" section in `docs/self-hosting.md`. No build args.
- Follow-up: the setup CLI writes `ICON_*` into `.env`. Connor would rather keep icon choice in the yaml only.
