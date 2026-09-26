---
id: "006"
title: "i18n and icon packages"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["002"]
---

## Question

Set up the two cross-cutting packages every UI ticket uses (`PLAN.md` D12, D19).

- `packages/i18n`: Lingui 6 config, `locales/en/messages.po`, compiled catalogs, `Intl`
  formatters (dates, numbers, relative time, file sizes), locale negotiation
  (`Accept-Language` → `user.locale`).
- `packages/icons`: web + React Native entry points exporting lucide-named icons plus
  semantic aliases; set mapping files (`lucide` first; the structure ready for phosphor,
  tabler, hugeicons and Material Symbols SVG); build-time set selection from config;
  lucide fallback with a gap report; the post-install codemod that rewrites
  `lucide-react` / `lucide-react-native` imports to `@workspace/icons`.
- Run the codemod over `packages/ui` and wire the i18n provider into `apps/web`.

## Owns

`packages/i18n`, `packages/icons`, and the import lines the codemod rewrites in `packages/ui`.

## Done when

- `apps/web` renders a translated string and an icon through the registry.
- The icon-import guard from 004 passes on the whole repo.
- Tests cover formatters, negotiation, the codemod and the gap report. CI green.
