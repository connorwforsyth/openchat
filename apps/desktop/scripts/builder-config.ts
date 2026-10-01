import type { Configuration } from "electron-builder";
import { z } from "zod";

import type { Identity } from "./brand";

// electron-builder's configuration from the brand (ticket 119), as a pure
// function so the mapping is tested without packaging anything. package.ts
// is the shell that runs it.

/** Where the packaging inputs and outputs live, relative to apps/desktop. */
export const PATHS = {
  /** Generated icons (brand-assets.ts); gitignored. */
  assets: ".brand",
  /** Committed build resources: the placeholder icon, entitlements. */
  buildResources: "build",
  /** Artifacts; gitignored. */
  output: "release",
  /** What goes in app.asar: the bundles and a minimal package.json. */
  stage: "dist/app",
} as const;

const repoSchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "owner/repo, like `acme/chat-desktop`");

/**
 * Packaging switches, from the environment so CI sets them beside the
 * signing secrets. Every one is optional; with none, the build is unsigned
 * and never looks for updates.
 */
export const packageEnvSchema = z.object({
  /**
   * `1` turns on auto-update from GitHub Releases. Off until builds are
   * signed: macOS refuses to apply an update to an unsigned app.
   */
  DESKTOP_AUTO_UPDATE: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
  /** The GitHub repository whose Releases carry the builds. */
  DESKTOP_UPDATE_REPO: repoSchema.optional(),
});

export interface AutoUpdate {
  readonly owner: string;
  readonly repo: string;
}

export interface PackageOptions {
  /** Null: off. The packaged app then never loads the updater. */
  readonly autoUpdate: AutoUpdate | null;
  /** Sign (and notarise, when Apple's credentials are present) on macOS. */
  readonly macSigning: "none" | "sign" | "sign-and-notarize";
  /** Sign on Windows. */
  readonly winSigning: boolean;
}

export type Env = Readonly<Record<string, string | undefined>>;

/** Any one of these is how electron-builder is given a macOS identity. */
const MAC_IDENTITY_VARS = ["CSC_LINK", "CSC_NAME"] as const;
/** Any one complete set lets notarytool run (docs/desktop.md). */
const NOTARY_VAR_SETS = [
  ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
  ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
  ["APPLE_KEYCHAIN_PROFILE"],
] as const;
const WIN_IDENTITY_VARS = ["WIN_CSC_LINK", "CSC_LINK"] as const;

const present = (env: Env, name: string) => Boolean(env[name]?.trim());

/**
 * Reads the switches. Only whether a signing variable is set is looked at,
 * never its value. Returns every problem rather than the first.
 */
export const packageOptionsFromEnv = (
  env: Env
):
  | { readonly ok: true; readonly value: PackageOptions }
  | { readonly error: readonly string[]; readonly ok: false } => {
  const parsed = packageEnvSchema.safeParse({
    DESKTOP_AUTO_UPDATE: env.DESKTOP_AUTO_UPDATE?.trim() || undefined,
    DESKTOP_UPDATE_REPO: env.DESKTOP_UPDATE_REPO?.trim() || undefined,
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      ),
      ok: false,
    };
  }
  const { DESKTOP_AUTO_UPDATE: autoUpdate, DESKTOP_UPDATE_REPO: repo } =
    parsed.data;
  if (autoUpdate && !repo) {
    return {
      error: ["DESKTOP_AUTO_UPDATE=1 needs DESKTOP_UPDATE_REPO (owner/repo)"],
      ok: false,
    };
  }
  const macIdentity = MAC_IDENTITY_VARS.some((name) => present(env, name));
  const notarize = NOTARY_VAR_SETS.some((set) =>
    set.every((name) => present(env, name))
  );
  const [owner = "", repoName = ""] = repo?.split("/") ?? [];
  let macSigning: PackageOptions["macSigning"] = "none";
  if (macIdentity) {
    macSigning = notarize ? "sign-and-notarize" : "sign";
  }
  return {
    ok: true,
    value: {
      autoUpdate: autoUpdate ? { owner, repo: repoName } : null,
      macSigning,
      winSigning: WIN_IDENTITY_VARS.some((name) => present(env, name)),
    },
  };
};

export interface BuilderInput {
  /** An unpacked Electron of the right version and arch, to skip a download. */
  readonly electronDist?: string;
  readonly electronVersion: string;
  readonly identity: Identity;
  readonly options: PackageOptions;
}

/** `${name}` placeholders are electron-builder's own, filled per artifact. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder's macros, not a template literal
const artifactName = "${productName}-${version}-${os}-${arch}.${ext}";

/**
 * The electron-builder configuration. Every target is declared here (macOS
 * dmg and zip, Windows nsis, Linux AppImage, each for arm64 and x64);
 * `desktop:package` picks the current platform and architecture from them.
 */
export const builderConfig = ({
  electronDist,
  electronVersion,
  identity,
  options,
}: BuilderInput): Configuration => {
  const signMac = options.macSigning !== "none";
  return {
    appId: identity.appId,
    artifactName,
    // The stage holds only the bundles (they carry their dependencies).
    // electron-builder would otherwise fall back to this package's
    // node_modules and ship the whole workspace's dependencies.
    asar: true,
    directories: {
      app: PATHS.stage,
      buildResources: PATHS.buildResources,
      output: PATHS.output,
    },
    electronDist,
    electronFuses: {
      // Must stay on for the asar check to mean anything.
      enableEmbeddedAsarIntegrityValidation: true,
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
      onlyLoadAppFromAsar: true,
      // Unsigned arm64 builds must be re-signed ad hoc after the binary
      // changes, or macOS kills them on launch. Signing replaces it.
      resetAdHocDarwinSignature: !signMac,
      runAsNode: false,
    },
    electronVersion,
    extraResources: [
      { filter: ["*.png"], from: `${PATHS.assets}/tray`, to: "brand" },
    ],
    // The tray's template image, read from Resources/brand at run time.
    files: ["**/*", "!**/node_modules/**"],
    linux: {
      category: "Network",
      executableName: identity.executableName,
      icon: `${PATHS.assets}/png`,
      synopsis: identity.name,
      target: [{ arch: ["x64", "arm64"], target: "AppImage" }],
    },
    mac: {
      category: "public.app-category.productivity",
      darkModeSupport: true,
      entitlements: signMac
        ? `${PATHS.buildResources}/entitlements.mac.plist`
        : undefined,
      entitlementsInherit: signMac
        ? `${PATHS.buildResources}/entitlements.mac.plist`
        : undefined,
      hardenedRuntime: signMac,
      icon: `${PATHS.assets}/icon.icns`,
      // null skips signing entirely; the fuses step re-signs ad hoc instead.
      identity: signMac ? undefined : null,
      notarize: options.macSigning === "sign-and-notarize",
      // zip beside the dmg: it's what electron-updater installs on macOS.
      target: [
        { arch: ["arm64", "x64"], target: "dmg" },
        { arch: ["arm64", "x64"], target: "zip" },
      ],
    },
    // Nothing native to rebuild: the bundles are plain JavaScript.
    npmRebuild: false,
    nsis: {
      oneClick: true,
      perMachine: false,
    },
    productName: identity.name,
    protocols: identity.urlScheme
      ? [{ name: identity.name, schemes: [identity.urlScheme] }]
      : undefined,
    // Uploading is never part of packaging (`publish: "never"` in package.ts);
    // this only writes app-update.yml so the app knows where to look.
    publish: options.autoUpdate
      ? [{ provider: "github", ...options.autoUpdate, releaseType: "release" }]
      : null,
    win: {
      icon: `${PATHS.assets}/icon.ico`,
      target: [{ arch: ["x64", "arm64"], target: "nsis" }],
    },
  };
};
