# @workspace/i18n

Lingui 6 setup shared by every app and package (PLAN.md D12): one catalog,
`Intl` formatters and locale negotiation.

## Layout

| Path | What |
|---|---|
| `lingui.config.ts` | The one Lingui config. Extraction scans `apps/` and `packages/`. |
| `locales/{locale}/messages.po` | Catalogs (committed). `en` is the source locale. |
| `locales/{locale}/messages.ts` | Compiled catalogs (gitignored, from `i18n:compile`). |
| `src/locales.ts` | Supported locales as a zod enum. |
| `src/format.ts` | `formatDate`, `formatNumber`, `formatRelativeTime`, `formatFileSize`. |
| `src/negotiate.ts` | `parseAcceptLanguage`, `negotiateLocale`, `resolveLocale` (`user.locale` wins, then `Accept-Language`). |
| `src/catalog.ts` | `getMessages(locale)`, `createI18n(locale)`. |
| `src/react/server.ts` | `initLingui(locale)` for React Server Components. |
| `src/react/client-provider.tsx` | `LinguiClientProvider` for client components. |

Formatters and negotiation are pure and never throw on bad input: invalid
dates or sizes format to `""`, malformed headers fall back to `en`.

## Scripts

- `bun run i18n:extract`: update `messages.po` from the macros in the source.
- `bun run i18n:compile`: compile catalogs. Turbo runs it before `build`, `dev`
  and `typecheck`, and `postinstall` runs it so editors resolve the import.
- `bun --filter @workspace/i18n i18n:check`: fails when the catalogs are out of
  sync with the source (`lingui check sync`); the CI hook-up belongs to the
  conventions ticket.

## Using it in Next.js

The root layout negotiates the locale, calls `initLingui(locale)` and wraps the
tree in `LinguiClientProvider`. Every page that renders strings calls
`initLingui` too, because App Router renders layouts and pages separately.
Then write strings with macros in server or client components:

```tsx
import { Trans, useLingui } from "@lingui/react/macro";

<Trans>Project ready!</Trans>
```

## Macros on Next 16

Macros work on Next 16.3.6 (Turbopack, `next build` and `next dev`) through
`@lingui/swc-plugin` in `experimental.swcPlugins`, **pinned to 6.6.0** in the
root catalog. 6.7.0 is built against `swc_core` 77.1.1 and Next 16.3.6's
`swc_plugin_runner` 30.0.1 can't load it: the build fails with "Failed to
execute SWC plugin … Failed to deserialize program received from host". 6.6.0
(`swc_core` 66.0.3) works. When upgrading Next or the plugin, check
<https://plugins.swc.rs> and run `ICON_SET= bun turbo build --filter web`.

A Vitest suite that renders macro-using components needs the same transform
(`@lingui/vite-plugin` or the SWC plugin via `unplugin-swc`); none does yet.
