import { z } from "zod";

// What a Site version stores (125). `artifact_version.content` is text, so
// a site is JSON text of this shape:
//
//   { "files": { "index.tsx": "import { Hero } from \"@workspace/site-ui\";…",
//                "about.html": "<!doctype html>…", "css/site.css": "…",
//                "app.js": "…", "logo.svg": "<svg…" } }
//
// `files` maps a relative path to the file's text. A page is an `.html`
// file, or a `.tsx` file (163) built from `@workspace/site-ui`'s blocks,
// which is served as the `.html` page of the same name. The home page is
// `index.tsx` or `index.html`. Sites are text only: raster images come from
// an allowed origin or a `data:` URL, and drawings are SVG.
//
// `stack` is legacy: 125 stored one ("html-tailwind") and 163 removed
// stacks, so it's still accepted, and nothing reads it.

/** What versions saved before 163 hold in `stack`; nothing reads it. */
export const DEFAULT_SITE_STACK = "html-tailwind";

/** The page a visitor lands on, once built. */
export const SITE_ENTRY = "index.html";

/** The files that can be the home page; a site has exactly one. */
export const SITE_ENTRY_SOURCES = ["index.tsx", "index.html"] as const;

/** The file types a site may hold, by extension. */
export const SITE_EXTENSIONS = [
  "html",
  "css",
  "js",
  "mjs",
  "json",
  "svg",
  "tsx",
  "txt",
] as const;

export const SITE_LIMITS = {
  /** All files' text together, in UTF-16 units, as the artifact tools cap content. */
  chars: 400_000,
  files: 40,
} as const;

const SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SITE_PATH = new RegExp(
  `^(?:${SEGMENT}/){0,7}${SEGMENT}\\.(?:${SITE_EXTENSIONS.join("|")})$`
);
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/;

/**
 * A file's place in the site: relative, `/`-separated, at most eight deep,
 * each part starting with a letter or digit (so nothing hidden and no
 * `..`), ending in one of `SITE_EXTENSIONS`.
 */
export const sitePathSchema = z
  .string()
  .max(256)
  .refine(
    (path) => SITE_PATH.test(path) && !PARENT_SEGMENT.test(path),
    `isn't a file path a site can have: use a relative path like "about.html" or "css/site.css", ending in .${SITE_EXTENSIONS.join(", .")}`
  );

/**
 * The files by path. Paths are checked one by one (rather than as the
 * record's key schema) so each bad one is named with the reason.
 */
export const siteFilesSchema = z
  .record(z.string(), z.string())
  .superRefine((files, context) => {
    for (const path of Object.keys(files)) {
      const parsed = sitePathSchema.safeParse(path);
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          message: parsed.error.issues[0]?.message ?? "isn't a valid path",
          path: [path],
        });
      }
    }
  });

export const siteSourceSchema = z.object({
  files: siteFilesSchema,
  /** Legacy (see above): accepted and never read. */
  stack: z.string().max(64).optional(),
});
export type SiteContent = z.infer<typeof siteSourceSchema>;

/**
 * A site version as stored: JSON text of `siteSourceSchema`. Text that
 * isn't JSON fails with one problem the model can act on.
 */
export const siteContentSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: 'isn\'t JSON. A site is {"files": {"index.tsx": "…"}}',
      });
      return z.NEVER;
    }
  })
  .pipe(siteSourceSchema);

/** The extension of `path`, lower-cased, without the dot. */
export const extensionOf = (path: string): string =>
  path.slice(path.lastIndexOf(".") + 1).toLowerCase();

/** The site as the JSON text a version stores. */
export const siteContentText = (content: SiteContent): string =>
  JSON.stringify({ files: content.files });

/** Whether `path` is a page written in TSX, served as `pageOf(path)`. */
export const isTsxPage = (path: string): boolean => extensionOf(path) === "tsx";

/** The page a visitor opens for `path`: `about.tsx` is served as `about.html`. */
export const pageOf = (path: string): string =>
  isTsxPage(path) ? `${path.slice(0, path.lastIndexOf("."))}.html` : path;
