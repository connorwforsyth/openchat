import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { Arch, build, Platform } from "electron-builder";

import { identityOf, readBrand } from "./brand";
import { writeBrandAssets } from "./brand-assets";
import { builderConfig, PATHS, packageOptionsFromEnv } from "./builder-config";

// `bun run desktop:package` (ticket 119): unsigned artifacts for this machine's
// platform and architecture in apps/desktop/release/ (gitignored). Brand from
// app.config.yaml, icons from its logo, then electron-vite's bundles staged
// alone into app.asar and packaged by electron-builder. Never publishes.
//
//   --arch=arm64,x64   other architectures (each downloads its Electron once)
//   --dir              the unpacked app only, no dmg/zip/installer (faster)

const appDir = join(import.meta.dirname, "..");
const require = createRequire(join(appDir, "package.json"));

function fail(problems: readonly string[]): never {
  for (const problem of problems) {
    console.error(`desktop:package: ${problem}`);
  }
  process.exit(1);
}

const args = process.argv.slice(2);
const archArg = args.find((arg) => arg.startsWith("--arch="))?.slice(7);
const dirOnly = args.includes("--dir");

const archOf = (name: string): Arch => {
  const arch = { arm64: Arch.arm64, x64: Arch.x64 }[name];
  return arch ?? fail([`unknown arch ${name} (arm64 or x64)`]);
};
const arches = (archArg ?? process.arch).split(",").map(archOf);

const brand = readBrand(process.env);
const options = packageOptionsFromEnv(process.env);
if (!(brand.ok && options.ok)) {
  fail([
    ...(brand.ok ? [] : brand.error),
    ...(options.ok ? [] : options.error),
  ]);
}
const brandValue = brand.value;
const packageOptions = options.value;
const identity = identityOf(brandValue.brand);

// 1. Icons.
const assets = writeBrandAssets(brandValue, packageOptions, (message) =>
  console.warn(`desktop:package: ${message}`)
);
console.log(
  `desktop:package: "${identity.name}" (${identity.appId}) from ${brandValue.source ?? "defaults"}; icons from ${assets.from}`
);

// 2. The bundles, built with the same environment (the brand goes into main).
const built = spawnSync("bunx", ["electron-vite", "build"], {
  cwd: appDir,
  stdio: "inherit",
});
if (built.status !== 0) {
  fail(["electron-vite build failed"]);
}

// 3. The stage: the bundles and a package.json, nothing else. Main and the
//    preloads carry their dependencies, so no node_modules are shipped.
const manifest = JSON.parse(
  readFileSync(join(appDir, "package.json"), "utf8")
) as { readonly version: string };
const stage = join(appDir, PATHS.stage);
rmSync(stage, { force: true, recursive: true });
mkdirSync(stage, { recursive: true });
for (const part of ["main", "preload", "renderer"]) {
  cpSync(join(appDir, "dist", part), join(stage, part), {
    filter: (path) => !path.endsWith(".map"),
    recursive: true,
  });
}
writeFileSync(
  join(stage, "package.json"),
  `${JSON.stringify(
    {
      author: identity.name,
      description: identity.name,
      main: "main/index.js",
      name: identity.executableName,
      productName: identity.name,
      type: "module",
      version: manifest.version,
    },
    null,
    2
  )}\n`
);

// 4. Package.
const electronVersion = (
  JSON.parse(
    readFileSync(require.resolve("electron/package.json"), "utf8")
  ) as { readonly version: string }
).version;
// The Electron `bun install` already unpacked, when it's this machine's arch:
// one less download. Other arches come from electron-builder's cache.
const localElectron = join(
  require.resolve("electron/package.json"),
  "..",
  "dist"
);
const electronDist =
  arches.length === 1 &&
  arches[0] === archOf(process.arch) &&
  existsSync(localElectron)
    ? localElectron
    : undefined;
const platform = Platform.current();
const targetsFor: Readonly<Record<string, readonly string[]>> = {
  linux: ["AppImage"],
  mac: ["dmg", "zip"],
  windows: ["nsis"],
};
const targetNames = dirOnly ? ["dir"] : (targetsFor[platform.name] ?? []);

if (packageOptions.macSigning === "none") {
  // Never pick up a certificate from the keychain by accident.
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

const started = Date.now();
const artifacts = await build({
  config: builderConfig({
    electronDist,
    electronVersion,
    identity,
    options: packageOptions,
  }),
  projectDir: appDir,
  // Uploading is a separate, deliberate step (docs/desktop.md).
  publish: "never",
  targets: platform.createTarget([...targetNames], ...arches),
}).catch((cause: unknown) =>
  fail([cause instanceof Error ? cause.message : String(cause)])
);
rmSync(stage, { force: true, recursive: true });

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sizeOf = (path: string): number => {
  const stats = statSync(path);
  return stats.isDirectory()
    ? readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0)
    : stats.size;
};
console.log(
  `desktop:package: done in ${Math.round((Date.now() - started) / 1000)}s, unsigned: ${packageOptions.macSigning === "none"}, auto-update: ${packageOptions.autoUpdate ? "on" : "off"}`
);
for (const artifact of artifacts.filter(
  (path) => !path.endsWith(".blockmap")
)) {
  console.log(`  ${artifact}  ${megabytes(sizeOf(artifact))}`);
}
