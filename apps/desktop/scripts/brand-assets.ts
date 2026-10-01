import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { type DesktopBuild, desktopBuildSchema } from "../src/main/build-info";
import {
  type BrandSource,
  iconCandidates,
  identityOf,
  isUrlLike,
  repoRoot,
} from "./brand";
import type { PackageOptions } from "./builder-config";
import {
  encodeIcns,
  encodeIco,
  ICNS_SIZES,
  ICO_SIZES,
  pngSize,
  type Raster,
  type SizedPng,
  trayTemplatePngs,
} from "./icons";

// The icon pipeline's shell (ticket 119): the brand's logo (or favicon), else
// the neutral placeholder in build/, rendered with resvg (an npm package; no
// downloads) to every size, then written as icon.icns, icon.ico, a PNG set
// for Linux and the menu bar's template image, all into .brand/ (gitignored).

const appDir = join(import.meta.dirname, "..");
export const assetsDir = join(appDir, ".brand");
export const PLACEHOLDER = join(appDir, "build", "placeholder-icon.svg");

const MIME: Readonly<Record<string, string>> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** The Linux icon set (electron-builder reads `<size>x<size>.png`). */
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024] as const;
/** Below this, the source is upscaled for the larger icons and looks soft. */
const SHARP_SOURCE_PX = 512;
/** The size the tray's ink is found at before it's scaled down. */
const TRAY_SOURCE_PX = 512;

interface IconSource {
  readonly data: Uint8Array;
  readonly mime: string;
  readonly path: string;
}

const shown = (path: string) => {
  const inRepo = relative(repoRoot, path);
  return inRepo.startsWith("..") ? path : inRepo;
};

/** The first usable logo or favicon, with a warning for each one skipped. */
export const pickIconSource = (
  source: BrandSource,
  warn: (message: string) => void
): IconSource => {
  for (const candidate of iconCandidates(source)) {
    if (isUrlLike(candidate)) {
      warn(`${candidate}: a URL; packaging doesn't download, so it's skipped`);
      continue;
    }
    const mime = MIME[extname(candidate).toLowerCase()];
    if (!mime) {
      warn(`${shown(candidate)}: not SVG, PNG or JPEG, so it's skipped`);
      continue;
    }
    if (!existsSync(candidate)) {
      warn(`${shown(candidate)}: not found, so it's skipped`);
      continue;
    }
    const data = new Uint8Array(readFileSync(candidate));
    const size = mime === "image/png" ? pngSize(data) : null;
    if (size && Math.min(size.width, size.height) < SHARP_SOURCE_PX) {
      warn(
        `${shown(candidate)}: ${size.width}×${size.height}; an SVG or a ${SHARP_SOURCE_PX}px+ PNG keeps the large icons sharp`
      );
    }
    return { data, mime, path: candidate };
  }
  return {
    data: new Uint8Array(readFileSync(PLACEHOLDER)),
    mime: "image/svg+xml",
    path: PLACEHOLDER,
  };
};

/**
 * The source centred in a transparent square, aspect kept: a wide logo
 * becomes a square icon without stretching. resvg draws the embedded image,
 * SVG or bitmap, at the target size, so every size is rendered, not scaled.
 */
const squareSvg = (icon: IconSource, size: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="data:${icon.mime};base64,${Buffer.from(icon.data).toString("base64")}"/></svg>`;

const render = (icon: IconSource, size: number) =>
  new Resvg(squareSvg(icon, size), {
    // Logos are shapes; text in one would need fonts the build may not have.
    font: { loadSystemFonts: false },
  }).render();

const renderPng = (icon: IconSource, size: number): SizedPng => ({
  png: new Uint8Array(render(icon, size).asPng()),
  size,
});

const renderRaster = (icon: IconSource, size: number): Raster => {
  const image = render(icon, size);
  return {
    height: image.height,
    pixels: new Uint8Array(image.pixels),
    width: image.width,
  };
};

export interface WrittenAssets {
  /** What main is told about the build (`.brand/build.json`). */
  readonly build: DesktopBuild;
  readonly dir: string;
  /** The file the icons came from (the placeholder when there's no logo). */
  readonly from: string;
  readonly placeholder: boolean;
}

/**
 * Writes every icon into .brand/, replacing what was there, and build.json:
 * the name, app ID and update switch electron.vite.config.ts gives main.
 */
export const writeBrandAssets = (
  source: BrandSource,
  options: PackageOptions,
  warn: (message: string) => void
): WrittenAssets => {
  const icon = pickIconSource(source, warn);
  rmSync(assetsDir, { force: true, recursive: true });
  mkdirSync(join(assetsDir, "png"), { recursive: true });
  mkdirSync(join(assetsDir, "tray"), { recursive: true });

  const identity = identityOf(source.brand);
  const build: DesktopBuild = {
    appId: identity.appId,
    autoUpdate: options.autoUpdate !== null,
    name: identity.name,
  };
  writeFileSync(
    join(assetsDir, "build.json"),
    `${JSON.stringify(desktopBuildSchema.parse(build))}\n`
  );

  const sizes = [...new Set([...ICNS_SIZES, ...ICO_SIZES, ...LINUX_SIZES])];
  const pngs = new Map(sizes.map((size) => [size, renderPng(icon, size)]));
  const pick = (list: readonly number[]) =>
    list.map((size) => pngs.get(size) as SizedPng);

  writeFileSync(join(assetsDir, "icon.icns"), encodeIcns(pick(ICNS_SIZES)));
  writeFileSync(join(assetsDir, "icon.ico"), encodeIco(pick(ICO_SIZES)));
  writeFileSync(join(assetsDir, "icon.png"), (pngs.get(1024) as SizedPng).png);
  for (const { png, size } of pick(LINUX_SIZES)) {
    writeFileSync(join(assetsDir, "png", `${size}x${size}.png`), png);
  }

  const tray = trayTemplatePngs(renderRaster(icon, TRAY_SOURCE_PX));
  if (tray) {
    // The `Template` suffix and `@2x` are what macOS's image loading keys on.
    writeFileSync(join(assetsDir, "tray", "trayTemplate.png"), tray.x1);
    writeFileSync(join(assetsDir, "tray", "trayTemplate@2x.png"), tray.x2);
  } else {
    warn(
      `${shown(icon.path)}: no mark to draw in the menu bar; it keeps the built-in bubble`
    );
  }
  return {
    build,
    dir: assetsDir,
    from: shown(icon.path),
    placeholder: icon.path === PLACEHOLDER,
  };
};
