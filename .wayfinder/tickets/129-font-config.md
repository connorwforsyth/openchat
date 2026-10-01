---
id: "129"
title: "Swap interface fonts from app.config.yaml"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02): "i would also want some easy font swapping too", so he can try other fonts the way `icons: { set: phosphor }` swaps icons.

## Done when

- `fonts: { sans, mono }` in app.config.yaml picks from bundled fonts: sans is Geist (default), Inter, IBM Plex Sans, Figtree or Manrope; mono is Geist Mono (default) or JetBrains Mono.
- Fonts come from npm packages, so nothing is downloaded at build or run time. A change applies on restart, with no rebuild.
- The schema test covers the defaults and rejects unknown fonts. Gate and e2e pass.

## Results (2026-10-02, loop)

- `packages/config`: adds `fontsSchema`. `apps/web/lib/fonts.ts`: one `localFont` per choice, and `fontClasses(fonts)` applies the chosen pair. The root layout reads the choice from the config it already loads.
- The non-Geist choices are Fontsource's Latin subsets; other scripts fall back to system fonts.
