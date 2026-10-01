import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { interpolateEnv } from "@workspace/config/parse";
import { appConfigSchema } from "@workspace/config/schema";
import { parse } from "yaml";
import { z } from "zod";

// The brand the desktop app is packaged as (ticket 119, PLAN.md D18): name,
// app ID, URL scheme and icon come from `brand:` in app.config.yaml at
// package time, never from a literal here. The packaged app shows one brand
// (whoever packages it), whichever instance it then connects to.

export const brandSchema = appConfigSchema.shape.brand;
export type Brand = z.infer<typeof brandSchema>;

export const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const webDir = join(repoRoot, "apps", "web");

export type Env = Readonly<Record<string, string | undefined>>;

export interface BrandSource {
  readonly brand: Brand;
  /** The config file's folder, which the logo's path is relative to. */
  readonly configDir: string | null;
  /** The file read, for the log; null when none exists and defaults apply. */
  readonly source: string | null;
}

/**
 * Where the config is looked for, first match wins: `CONFIG_PATH` (relative
 * to apps/web, as the web server and `icons:select` read it), then
 * apps/web/app.config.yaml (`bun dev`), then the repo root's (`bun run
 * setup`, Docker).
 */
export const configCandidates = (env: Env): readonly string[] => {
  const explicit = env.CONFIG_PATH?.trim();
  return explicit
    ? [resolve(webDir, explicit)]
    : [join(webDir, "app.config.yaml"), join(repoRoot, "app.config.yaml")];
};

const readIfExists = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, "utf8") : undefined;

export type BrandResult =
  | { readonly ok: true; readonly value: BrandSource }
  | { readonly error: readonly string[]; readonly ok: false };

/**
 * Reads only the `brand:` block, so packaging doesn't need the server's
 * secrets or a config that's valid in every other section.
 */
export const readBrand = (
  env: Env,
  readText: (path: string) => string | undefined = readIfExists
): BrandResult => {
  for (const path of configCandidates(env)) {
    const text = readText(path);
    if (text === undefined) {
      continue;
    }
    const shown = relative(repoRoot, path).startsWith("..")
      ? path
      : relative(repoRoot, path);
    let document: unknown;
    try {
      document = parse(text);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        error: [`${shown}: YAML: ${message.split("\n")[0]}`],
        ok: false,
      };
    }
    const block =
      typeof document === "object" && document !== null
        ? (document as Record<string, unknown>).brand
        : undefined;
    const interpolated = interpolateEnv(block ?? {}, env, ["brand"]);
    const parsed = brandSchema.safeParse(interpolated.value);
    const problems = [
      ...interpolated.errors.map((error) => error.message),
      ...(parsed.success
        ? []
        : parsed.error.issues.map(
            (issue) => `brand.${issue.path.join(".")}: ${issue.message}`
          )),
    ];
    if (problems.length > 0 || !parsed.success) {
      return {
        error: problems.map((problem) => `${shown}: ${problem}`),
        ok: false,
      };
    }
    return {
      ok: true,
      value: { brand: parsed.data, configDir: dirname(path), source: shown },
    };
  }
  if (env.CONFIG_PATH?.trim()) {
    return {
      error: [
        `CONFIG_PATH is set to ${configCandidates(env)[0]}, which doesn't exist`,
      ],
      ok: false,
    };
  }
  return {
    ok: true,
    value: { brand: brandSchema.parse({}), configDir: null, source: null },
  };
};

/** Lowercase letters and digits, words joined by `-`. Empty if nothing's left. */
export const slugOf = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** What the packaged app is called and identified as, every fallback applied. */
export const identitySchema = z.object({
  appId: z.string(),
  /** Lowercase, no spaces: the Linux binary and artifact names. */
  executableName: z.string(),
  name: z.string(),
  urlScheme: z.string().nullable(),
});
export type Identity = z.infer<typeof identitySchema>;

/** Used when the name has no letters or digits to make a slug from. */
const FALLBACK_SLUG = "chat";

/**
 * The brand with fallbacks: no `appId` becomes `local.<slug>.desktop` (a
 * reverse-DNS name nobody owns, fine for unsigned builds; set a real one
 * before signing). No `urlScheme` registers none, since nothing handles deep
 * links yet; the app doesn't claim a scheme it wasn't given.
 */
export const identityOf = (brand: Brand): Identity => {
  const slug = slugOf(brand.name) || FALLBACK_SLUG;
  return {
    appId: brand.appId ?? `local.${slug}.desktop`,
    executableName: slug,
    name: brand.name,
    urlScheme: brand.urlScheme,
  };
};

/** `scheme:…`, but not a Windows drive letter (`C:\\…`). */
const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE_LETTER = /^[a-z]:[\\/]/i;
export const isUrlLike = (value: string): boolean =>
  URL_LIKE.test(value) && !DRIVE_LETTER.test(value);

/** Logo first, then favicon; each resolved against the config file's folder. */
export const iconCandidates = (source: BrandSource): readonly string[] =>
  [source.brand.logo, source.brand.favicon].flatMap((value) => {
    if (!value) {
      return [];
    }
    if (isUrlLike(value)) {
      // A URL (http:, data:, …): packaging never downloads (ticket 119).
      return [value];
    }
    return [
      isAbsolute(value) ? value : resolve(source.configDir ?? webDir, value),
    ];
  });
