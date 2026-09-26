# 0006: React Native Reusables on Expo SDK 57 with Uniwind

- Status: accepted
- Date: 2026-09-26
- Ticket: [003](../../.wayfinder/tickets/003-risk-checks.md), `PLAN.md` §12 check 6
- Result: **PASS** for native (iOS bundle). Caveat: Uniwind breaks the Expo **web** bundle.
  Not run on a device or simulator.

## Context

`PLAN.md` §5 plans the mobile app as Expo SDK 57 + Expo Router + React Native Reusables (RNR)
+ Uniwind, and marks RNR's SDK 57 support as unverified. This affects the Mobile wave only.

## Check performed

Using the standalone Expo SDK 57 app from [0002](0002-bun-expo-autolinking-electron-native.md):

1. Read RNR's source (github.com/founded-labs/react-native-reusables @ `a477f2c`,
   2026-09-16) and its `minimal-uniwind` template (@ `ecdc14b`).
2. Set up Uniwind the way the template does:
   - `withUniwindConfig` in `metro.config.js`;
   - `@import "tailwindcss"; @import "uniwind";` plus the template's theme in
     `src/global.css`;
   - `components.json`, `lib/utils.ts`, `lib/theme.ts`, and `<PortalHost />` in the root
     layout.
3. `bunx expo install uniwind tailwindcss tw-animate-css tailwindcss-animate class-variance-authority clsx tailwind-merge @rn-primitives/portal @rn-primitives/slot`
4. `bunx @react-native-reusables/cli@0.7.1 add button text -y`, then used `<Button>`/`<Text>`
   with Uniwind classes in a screen.
5. RNR `doctor`, `tsc --noEmit`, and `expo export --platform ios --platform web`.

Versions: `expo@57.0.25`, `react-native@0.86.3`, `react@19.2.3`, `uniwind@1.12.0`,
`tailwindcss@4.3.3`, `@rn-primitives/slot@1.5.2`, `@rn-primitives/portal@1.5.3`,
`react-native-reanimated@4.5.1`, `react-native-web@0.21.3`,
`@react-native-reusables/cli@0.7.1`.

## Evidence

- **RNR is still on SDK 56 upstream.** Its registry package and templates declare
  `expo ~56`, `react-native 0.85.3`, `uniwind ^1.6.3` / `^1.9.0`. The `@rn-primitives/*`
  packages accept any version (`peerDependencies: react/react-native/react-native-web: "*"`),
  so nothing blocks SDK 57 at install time.
- **Uniwind is first-class** (RNR changelog, December 2025): the CLI detects
  `uniwind-types.d.ts` and serves the `/r/uniwind/*` registry items.

```text
ℹ Styling Library: Uniwind
✔ Created 2 files:
  - src/components/ui/text.tsx
  - src/components/ui/button.tsx
```

- `doctor` first flagged missing `tailwindcss-animate` and the theme file (the manual setup
  had skipped them). After adding both: `✔ All checks passed.`
- `tsc --noEmit`: the `className` errors on RN components cleared once Metro had generated
  `uniwind-types.d.ts`. What was left was unrelated to RNR (the template's CSS-module and
  side-effect `.css` imports without `expo-env.d.ts`).
- **iOS:** `iOS Bundled 13993ms node_modules/expo-router/entry.js (1735 modules)`.
- **Web: fails with Uniwind enabled, passes without it.**

```text
Web Bundling failed … Unable to resolve module ./exports/InputAccessoryView from
…/node_modules/react-native-web/dist/index.js
```

  The file exists in `react-native-web@0.21.3`. With the stock Metro config (no
  `withUniwindConfig`), `Web Bundled … (1406 modules)`. The failure comes from Uniwind's
  web resolver with this react-native-web version, not from RNR.

## Consequence for the plan

- **Keep RNR + Uniwind for the Mobile wave.** No fallback is needed for iOS/Android.
- Before building on it, the Mobile wave should:
  - run on a simulator or device (not possible here: no Xcode or CocoaPods);
  - pin `uniwind` and track RNR's move to SDK 57;
  - include `tailwindcss-animate` and the theme file in its setup checklist, because
    RNR `doctor` requires them.
- Expo web is not a target (web is Next.js, D6), so the Uniwind web failure doesn't block
  anything. If Expo web is ever wanted, re-test Uniwind first or report it upstream.
- D5's token generator still needs to write Uniwind's `@theme` / `@variant light|dark`
  CSS-variable format (the template's `global.css` shows the shape).
