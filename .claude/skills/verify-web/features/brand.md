# Brand assets

The instance's logo, tab icon and home-screen icons come from `brand:` in
`app.config.yaml` (docs/self-hosting.md, "Logo and icons"). Each logo file
is drawn one of two ways: a one-colour SVG is a mask filled with the text
colour, so it follows the app theme; anything else is shown as it is, with
`logoDark` on dark themes. The verify-web instance has one of each, and a
favicon next/og can't draw, so its tiles show the fallback.

## Sub-features

- `brand-logo-mask`: light theme, `brand/logo.svg` (one colour) as a mask
  in the text colour (`span.bg-current`, a hidden `<img>` for its size).
- `brand-logo-image`: dark theme, `e2e/support/brand/badge.svg` (a
  `currentColor` square on a red badge) as an `<img>` from
  `/brand/logo-dark`; the square stays dark on the red.
- `brand-theme`: the app theme (`localStorage.theme`) wins over the OS.
- `brand-tab-icon`: the head links `/brand/icon.svg` (the mark wrapped in an
  SVG; a one-colour mark inverts under `prefers-color-scheme: dark`) and
  `/brand/icon-32.png`; `/favicon.ico` serves the 32px PNG.
- `brand-app-icons`: `apple-touch-icon` is `/brand/apple-icon.png` (180px);
  the manifest lists 192 and 512 icons and a 512 maskable one. A mark that
  can't be drawn gives placeholder tiles, never a 500.

## How to get to it (user POV)

- Open `/sign-in`, light or dark.
- The tab shows the icon; Add to Home Screen or Install app uses the
  manifest and the Apple icon.
- Signed in, the sidebar's top row is the space switcher, which keeps the
  name; there's no logo there.

## Driving it with verify-web

- Journey `brand`: the mask on light (clearing its fill changes the
  pixels), the badge on dark (centre pixel dark, edge red), the app's dark
  theme over a light OS, head links, the manifest and every PNG's real size,
  `/favicon.ico`, and the icons drawn at 128px on each scheme.
- Evidence: `evidence/brand/01-sign-in-light`, `02-sign-in-dark`,
  `03-app-dark-on-light-os`, `04-head-and-manifest.json`,
  `04-icons-{light,dark}.png`.

## Gotchas

- `e2e/support/serve.ts` points `brand.logo`, `logoDark` and `favicon` at
  files in the repo by absolute path, since its config lives in a temp dir.
- Assets are made once per process; a failed tile isn't kept, so it's
  retried on the next request.
- Headless Chromium draws no tab strip, so the journey draws the tab icon
  in a page of its own.
