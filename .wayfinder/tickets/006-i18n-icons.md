---
id: "006"
title: "i18n and icon packages"
labels: [wayfinder:build]
status: closed
assignee:
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

## Resolution (2026-09-26, loop)

Built in [PR #3](https://github.com/connorwforsyth/openchat/pull/3): `packages/i18n` (Lingui 6.8, `en` catalog, compile, `Intl` formatters, `Accept-Language` negotiation, RSC + client providers) and `packages/icons` (74 lucide-named icons + aliases, lucide and Phosphor sets chosen by `ICON_SET` at build time, lucide fallback + gap report, post-install codemod). `apps/web` renders a translated string and a registry icon; fonts come from the `geist` package. The loop pointed `packages/ui` at `@workspace/icons` and the catalog's `zod`.

Verified: `bun turbo typecheck lint test build --force` 17/17 on main + 004 guards; empty-env production start returns 200 with the translated text and `lucide-send`; the Phosphor build swaps the SVG; CI passed.

Note: Lingui macros on Next 16.3 need `@lingui/swc-plugin` pinned to exactly 6.6.0. `ICON_SET` stands in for `app.config.yaml` `icons.set` until 005's config lands.
