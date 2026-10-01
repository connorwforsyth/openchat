---
id: "119"
title: "Desktop packaging and auto-update"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

Signing and notarising macOS builds needs an Apple Developer account (paid); Windows signing needs a certificate (paid). The loop spends nothing, so this ticket ships unsigned builds and documents signing, until Connor decides (122).

## Done when

- electron-builder config for macOS (dmg, arm64 + x64), Windows (nsis) and Linux (AppImage), with the instance's brand (name, icon, app ID) read from the brand block.
- Auto-update via GitHub Releases, wired but off until builds are signed. A local `bun run desktop:package` produces unsigned artifacts.
- Docs: how to sign and notarise once accounts exist. Gate passes.

## Owns

`apps/desktop/**` (build config), `docs/desktop.md`.

## Results (2026-10-02, loop)

- **Brand → packaging** (`apps/desktop/scripts/brand.ts`,
  `builder-config.ts`): only the `brand:` block of `app.config.yaml` is
  read (`CONFIG_PATH` relative to apps/web, else `apps/web/app.config.yaml`,
  else the root's; `${ENV}` interpolated; validated with the config's own
  brand schema). Fallbacks: app ID `local.<slug>.desktop`, no URL scheme
  (nothing handles deep links yet), the neutral placeholder icon.
  electron-builder config: macOS dmg + zip (arm64, x64), Windows NSIS,
  Linux AppImage; `protocols` from `urlScheme`; only electron-vite's
  bundles are staged into `app.asar` (1.7 MB, no node_modules).
- **Dev app shows the brand:** `bun run brand` (before every build and dev
  run) writes `.brand/build.json`; electron-vite defines it into main as
  `__DESKTOP_BUILD__`, and main calls `app.setName` and puts userData under
  the brand's name (so dev settings move from `…/desktop` to `…/<name>`),
  sets the Dock icon in dev, and the AUMID on Windows. macOS's bold
  menu-bar title in a dev run still reads "Electron" (it comes from the
  Electron bundle's Info.plist).
- **Icons** (`scripts/icons.ts` pure, `brand-assets.ts` shell): logo (else
  favicon; SVG/PNG/JPEG, URLs skipped, never downloaded) rendered with
  `@resvg/resvg-js` at every size; ICNS, ICO and PNG written by hand
  (iconutil reads the ICNS back). Menu bar template image from the same
  source: ink = alpha for a logo on transparency, or what differs from the
  backdrop's median colour for a logo on a tile; cropped, fitted to 16/32px
  with 1pt padding. The drawn bubble stays as the fallback.
- **Fuses:** RunAsNode, NODE_OPTIONS and --inspect off; embedded ASAR
  integrity and OnlyLoadAppFromAsar on; unsigned arm64 re-signed ad hoc
  (`resetAdHocDarwinSignature`). Checked: `@electron/fuses` reads the wire
  back; a tampered `app.asar` dies with `asar_file_validator … FATAL`.
- **Auto-update** (`src/main/updates.ts`): electron-updater from GitHub
  Releases, on only when packaged with `DESKTOP_AUTO_UPDATE=1` +
  `DESKTOP_UPDATE_REPO`; off, the module is never imported. On-path checked
  with a throwaway build behind `--proxy-server=127.0.0.1:9`: it reads
  `app-update.yml` and reports `ERR_PROXY_CONNECTION_FAILED` (no request
  left the machine). Off build: no update activity.
- **`bun run desktop:package`** (turbo task `package`, `--arch=`, `--dir`):
  unsigned, `publish: "never"`, artifacts in `apps/desktop/release/`
  (gitignored). On this Mac (arm64): ~50 s; `Chat.app` 289 MB (285 MB is
  Electron Framework), dmg 120.9 MB, zip 121.0 MB.
- **Packaged smoke** (`bun run package:smoke`, `scripts/smoke-packaged.ts`):
  `_electron` can't attach once the inspector fuse is off, so it launches
  the binary with `--remote-debugging-port=0` and a temp profile, connects
  over CDP, checks the fuses and the first-run window, optionally connects
  to `--instance`, then quits the process group. Passed, including against
  the e2e server (port 3297): the window reached `/sign-in`.
- **Docs:** `docs/desktop.md` (build, unsigned installs and Gatekeeper's
  right-click Open, signing with `CSC_*`, notarising with notarytool's three
  credential sets, Windows certs, turning on auto-update and publishing a
  release); README section.
- **Tests:** desktop unit tests 178 (was 121): brand reading and fallbacks,
  builder config and signing switches, PNG/ICO/ICNS writers, the template
  mask, the update rule.
- **Verification:** `gate.sh` 93/93 tasks, `evals --strict: ok`; `bun run
  check` and `check:guards` exit 0. `E2E_DESKTOP_PORT=3299 bun turbo
  test:desktop`: 1 passed. Web e2e through the queue on 3298: 89 passed,
  none failed or flaky.

Touched outside **Owns**: root `package.json` (`desktop:package` script) and
`bun.lock`. New dev deps in apps/desktop: electron-builder 26.15.3,
@resvg/resvg-js, @electron/fuses 1.8.0, yaml, @workspace/config; runtime:
electron-updater 6.8.9 (bundled into main as a lazy chunk).

Open:
- electron-builder downloads its own tools once (the Electron zip per arch
  unless `node_modules/electron/dist` matches, and the checksum-pinned
  `dmgbuild` bundle from its GitHub releases). The icon pipeline downloads
  nothing.
- electron-vite has no stable release with Vite 8 support yet (latest is
  5.0.0 for Vite ≤7; 6.0.0-beta.5 is still beta), so it stays on the beta.
- Only arm64 macOS was built and run here; x64 (`--arch=x64`), NSIS and
  AppImage are configured and unit-tested but not built.
- `EnableCookieEncryption` left off (it ties cookies to a keychain entry,
  which unsigned builds would prompt for); worth turning on with signing.
- A brand `appId` change after release orphans settings and updates;
  `local.*` IDs are for unsigned builds only.
