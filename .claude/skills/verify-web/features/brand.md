# Brand assets

The instance's logo, tab icon and home-screen icons come from `brand:` in
`app.config.yaml` (docs/self-hosting.md, "Logo and icons"). The verify-web
instance's logo is the repo's placeholder, `brand/logo.svg`, a
`currentColor` mark, so it takes the app theme's text colour on sign-in, the
tab icon switches with the OS scheme, and the home-screen icons are white
marks on black tiles.

## Sub-features

- `brand-logo`: sign-in shows the logo above the name. Each theme has a
  paint layer (`<img>`, `/brand/logo` or `/brand/logo-dark`) over an ink
  layer (a CSS mask of `/brand/logo-ink` or `/brand/logo-dark-ink` in the
  text colour).
- `brand-theme`: the logo follows the app theme (`localStorage.theme`), not
  the OS.
- `brand-tab-icon`: the head links `/brand/icon.svg` (switches inside the
  SVG with `prefers-color-scheme`) and `/brand/icon-32.png`.
- `brand-app-icons`: `apple-touch-icon` is `/brand/apple-icon.png` (180px);
  the manifest lists 192 and 512 icons and a 512 maskable one.

## How to get to it (user POV)

- Open `/sign-in`, light or dark.
- The tab shows the icon; Add to Home Screen or Install app uses the
  manifest and the Apple icon.
- Signed in, the sidebar's top row is the space switcher (`Personal`), so
  the logo shows there only before spaces load.

## Driving it with verify-web

- Journey `brand`: logo colours per scheme and with the app theme set dark
  on a light OS (each step checks that hiding the ink layer changes the
  pixels, so the mark is drawn in the theme colour), head links, manifest
  and PNG sizes, and the icons drawn at 128px on each scheme.
- Evidence: `evidence/brand/01-sign-in-{light,dark}`,
  `02-head-and-manifest.json`, `02-icons-{light,dark}.png`,
  `03-app-dark-on-light-os`.

## Gotchas

- `e2e/support/serve.ts` points `brand.logo` at the repo's
  `brand/logo.svg` by absolute path, since its config lives in a temp dir.
- Assets are made once per process. After editing `packages/config/src/brand.ts`
  in dev mode, wait for `/brand/logo-ink` to change before rerunning.
- Headless Chromium draws no tab strip, so the journey draws the tab icon
  in a page of its own.
