# Desktop app

The desktop app (`apps/desktop`) is an Electron shell around your server's
own web app: on first run it asks for the server's address, and from then on
its window is that server. How the shell works is in
`apps/desktop/README.md`; this page is about building, signing and shipping
it.

Builds are **unsigned** for now (ticket 122): signing needs an Apple
Developer account (US$99 a year) and a Windows code-signing certificate, and
macOS auto-update needs a signed app. Everything below for signing is ready
to switch on once those exist.

## Building

```sh
bun install
bun run desktop:package                      # this Mac's arch: dmg + zip
bun run desktop:package -- --arch=arm64,x64  # both Mac arches
bun run desktop:package -- --dir             # just the .app, no dmg (faster)
bun run --cwd apps/desktop package:smoke     # launch it and check it, then quit
```

Artifacts land in `apps/desktop/release/` (gitignored), named
`<Name>-<version>-<os>-<arch>.<ext>`. The command builds for the platform
it runs on: macOS gives a `.dmg` and a `.zip`, Windows an NSIS installer and
Linux an AppImage (all three are configured; build each on its own OS, or
in CI). The version is `apps/desktop/package.json`'s.

What happens, in `apps/desktop/scripts/package.ts`:

1. **Brand.** The `brand:` block of `app.config.yaml` is read: `CONFIG_PATH`
   (relative to `apps/web`, as the server reads it), else
   `apps/web/app.config.yaml`, else the repo root's. Only that block is read
   and validated, so packaging needs none of the server's secrets.
   - `name` is the app's name (menu bar, Dock, About, installer) and the
     folder its settings live in.
   - `appId` is the bundle ID. Without one it's `local.<name>.desktop`,
     fine for unsigned builds; set a real reverse-DNS ID you own before
     signing, and don't change it after (macOS and Windows key updates,
     settings and permissions on it).
   - `urlScheme` registers a `<scheme>://` link handler. Without one, none
     is registered.
   - `logo` (else `favicon`) is the icon, relative to the config file. SVG
     is best; PNG or JPEG work (512px or more keeps them sharp). A URL is
     skipped, since packaging never downloads. With neither, a neutral
     placeholder (`apps/desktop/build/placeholder-icon.svg`) is used.
2. **Icons** (`scripts/brand-assets.ts`, also run before every build and
   dev run): the logo is rendered with resvg to every size and written to
   `apps/desktop/.brand/` as `icon.icns`, `icon.ico`, a PNG set for Linux,
   and the menu bar's template image (`tray/trayTemplate.png` and `@2x`).
   The menu bar icon is the logo's mark in black, shaped by its alpha:
   a logo on transparency gives its own shape; a logo on a solid tile gives
   whatever stands out from the tile. A simple, single-colour mark on
   transparency looks most at home in the menu bar.
3. **Bundles.** `electron-vite build`, with the brand's name and app ID
   written into main, so a dev run is named like the packaged app (except
   macOS's bold menu bar title in a dev run, which comes from the Electron
   bundle).
4. **Package.** The bundles alone (they carry their dependencies, so no
   `node_modules` are shipped) go into `app.asar`, and electron-builder
   makes the app and its installers. Electron's fuses are set:

   | Fuse | | Why |
   |---|---|---|
   | `RunAsNode` | off | `ELECTRON_RUN_AS_NODE` can't turn the app into a Node runtime |
   | `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` can't inject code |
   | `EnableNodeCliInspectArguments` | off | `--inspect` can't attach a debugger |
   | `EnableEmbeddedAsarIntegrityValidation` | on | `app.asar` is checked against the hash in the bundle |
   | `OnlyLoadAppFromAsar` | on | the app only loads from that checked archive |

   An unsigned Apple Silicon build is re-signed ad hoc after the fuses
   change the binary (macOS won't run it otherwise). Signing replaces that.

`bun run --cwd apps/desktop package:smoke` launches the packaged app with
a temporary profile, checks the fuses and that the first-run window
appears, then quits it. `-- --instance http://localhost:3000` also connects
it to a running server. (Playwright's Electron driver can't attach to a
packaged build, because the fuses turn off the inspector it uses; the
script connects over Chromium's debugging port instead.)

electron-builder fetches a few of its own tools the first time (the Electron
zip for each arch, and the dmg builder), checksum-verified, into its cache.
The icons need nothing from the network.

## What "unsigned" means for people

- **macOS:** Gatekeeper blocks an app from an unidentified developer. The
  first time, **right-click (or Control-click) the app › Open**, then
  **Open** in the dialog. On macOS 15 and later, if there's no Open button:
  try to open it once, then **System Settings › Privacy & Security ›
  Open Anyway**. After that it opens normally. A downloaded app may also
  need `xattr -dr com.apple.quarantine "/Applications/<Name>.app"` if macOS
  says it's damaged.
- **Windows:** SmartScreen shows "Windows protected your PC". Click
  **More info › Run anyway**.
- **Linux:** an AppImage needs `chmod +x` and no signature.
- No auto-update (see below): people download new versions themselves.

## Signing and notarising (once the accounts exist)

Nothing in the code changes: set the variables and run
`bun run desktop:package` again. `scripts/builder-config.ts` turns signing
on when it sees them (it checks only that they're set, never their values).
Keep them in CI secrets or your shell, never in the repo.

### macOS

1. Join the Apple Developer Program, and create a **Developer ID
   Application** certificate (Xcode › Settings › Accounts, or the developer
   site). Export it with its private key as a `.p12`.
2. Set a real `brand.appId`.
3. Signing, either:
   - `CSC_LINK` (path, `file://` URL or base64 of the `.p12`) and
     `CSC_KEY_PASSWORD`; or
   - `CSC_NAME` (the certificate's name, if it's in your login keychain).
4. Notarising, one of these sets (electron-builder runs `notarytool` and
   staples the ticket):
   - App Store Connect API key (recommended for CI): `APPLE_API_KEY` (path
     to the `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`;
   - Apple ID: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from
     appleid.apple.com), `APPLE_TEAM_ID`;
   - a stored profile (`xcrun notarytool store-credentials`):
     `APPLE_KEYCHAIN_PROFILE`.

With an identity set, the build uses the hardened runtime with
`apps/desktop/build/entitlements.mac.plist` (V8 needs `allow-jit`) and
drops the ad-hoc re-sign. Check a result with:

```sh
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/<Name>.app"
spctl --assess --type execute --verbose "release/mac-arm64/<Name>.app"
xcrun stapler validate "release/<Name>-<version>-mac-arm64.dmg"
```

### Windows

Buy a code-signing certificate (an EV or OV certificate, or Azure Trusted
Signing), then set `WIN_CSC_LINK` (or `CSC_LINK`) and `WIN_CSC_KEY_PASSWORD`
(or `CSC_KEY_PASSWORD`) and build on Windows. Hardware-token and cloud
certificates use electron-builder's `win.signtoolOptions` / `azureSignOptions`
instead; add them in `builderConfig` when the certificate is chosen.

## Auto-update

electron-updater is wired to GitHub Releases but **off**. Off, the updater
isn't even loaded, so the app makes no update requests. Turn it on only for
signed builds: macOS refuses to install an update into an unsigned app, and
Windows would warn on every update.

1. Set, when packaging:

   ```sh
   DESKTOP_AUTO_UPDATE=1 DESKTOP_UPDATE_REPO=owner/repo bun run desktop:package -- --arch=arm64,x64
   ```

   The build then carries `app-update.yml` pointing at that repository's
   Releases, and on launch the packaged app checks, downloads in the
   background and installs on quit. (A dev run never checks.)
2. Publish a release: create a GitHub release whose tag is `v<version>`
   and upload every file in `release/` except the unpacked folders and
   `builder-debug.yml`: the dmg and zip (macOS installs from the zip), the
   installer, the AppImage, their `.blockmap`s and the `latest*.yml` files.
   Packaging never uploads (`publish: "never"`); doing it is a deliberate
   step. To let electron-builder upload instead, run it with
   `--publish always` and a `GH_TOKEN` that can write releases.
3. Bump `apps/desktop/package.json`'s `version` for every release; the
   updater compares versions.

A private repository's releases need a token in the app, which isn't
wired; publish desktop releases from a public repository.
