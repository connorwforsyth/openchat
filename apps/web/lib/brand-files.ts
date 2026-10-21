import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";

import {
  type BrandImage,
  type BrandImages,
  brandImages,
} from "@workspace/config/brand";
import { loadConfig } from "@workspace/config/load";
import { appConfigSchema } from "@workspace/config/schema";

// Reads the files `brand:` names, relative to the config file, once per
// process (config changes apply on restart, D18). A file that's missing or
// unusable is skipped with a warning and the next fallback applies: the brand
// never stops the app from booting.

export interface BrandFiles extends BrandImages {
  /** The colour behind the mark on home-screen icons. */
  readonly iconBackground: string;
}

const RASTER_MIME = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
} as const;

/** `scheme:…`, but not a Windows drive letter (`C:\\…`). */
const URL_LIKE = /^[a-z][a-z0-9+.-]+:/i;

const readImage = async (
  value: string | null,
  configDir: string
): Promise<BrandImage | null> => {
  if (!value) {
    return null;
  }
  if (URL_LIKE.test(value)) {
    // D27: the page loads nothing from third-party hosts.
    console.warn(`[brand] ${value}: a URL, not a file; it's skipped`);
    return null;
  }
  const path = isAbsolute(value) ? value : resolve(configDir, value);
  const extension = extname(path).toLowerCase();
  try {
    if (extension === ".svg") {
      return { kind: "svg", text: await readFile(path, "utf8") };
    }
    if (Object.hasOwn(RASTER_MIME, extension)) {
      return {
        data: new Uint8Array(await readFile(path)),
        kind: "raster",
        mime: RASTER_MIME[extension as keyof typeof RASTER_MIME],
      };
    }
    console.warn(`[brand] ${path}: not SVG, PNG or JPEG; it's skipped`);
  } catch {
    console.warn(`[brand] ${path}: can't be read; it's skipped`);
  }
  return null;
};

const load = async (): Promise<BrandFiles> => {
  const loaded = await loadConfig().catch(() => null);
  if (!loaded?.ok) {
    const { iconBackground } = appConfigSchema.shape.brand.parse(undefined);
    return {
      ...brandImages({ favicon: null, logo: null, logoDark: null }),
      iconBackground,
    };
  }
  const { config, source } = loaded.value;
  const configDir = source ? dirname(source) : process.cwd();
  const [favicon, logo, logoDark] = await Promise.all(
    [config.brand.favicon, config.brand.logo, config.brand.logoDark].map(
      (value) => readImage(value, configDir)
    )
  );
  return {
    ...brandImages({
      favicon: favicon ?? null,
      logo: logo ?? null,
      logoDark: logoDark ?? null,
    }),
    iconBackground: config.brand.iconBackground,
  };
};

let loading: Promise<BrandFiles> | undefined;

export const getBrandFiles = (): Promise<BrandFiles> => {
  loading ??= load();
  return loading;
};
