// The brand's files as the web app serves them (`apps/web/app/brand`), from
// whatever `brand:` names in app.config.yaml (D18). One SVG is enough: the
// logo stands in for the square icon, and a built-in mark stands in when
// there's no logo at all.
//
// A logo is drawn one of two ways, decided per file. A one-colour SVG (its
// paint is all `currentColor`, or it names no colours) is a mask filled with
// the text colour, so it follows the app's theme. Anything else is drawn as
// it is, with `logoDark` in its place on dark themes. The files are served
// untouched: icons wrap them rather than edit their markup.

/** A logo or icon as read from disk. */
export type BrandImage =
  | { readonly kind: "svg"; readonly text: string }
  | {
      readonly kind: "raster";
      readonly data: Uint8Array<ArrayBuffer>;
      readonly mime: "image/jpeg" | "image/png";
    };

export type BrandTheme = "dark" | "light";

/** Each file the web app serves under `/brand/`, and how it's made. */
export type BrandAsset =
  /** The logo file for one theme, as it is. */
  | { readonly kind: "logo"; readonly theme: BrandTheme }
  /** The tab icon, an SVG whatever the source. */
  | { readonly kind: "icon" }
  /** A PNG of the mark on the icon background, `markScale` of its width. */
  | {
      readonly kind: "tile";
      readonly markScale: number;
      readonly size: number;
    };

// A maskable icon's safe zone is the centre circle, 80% across; the mark sits
// well inside it. Other tiles leave a margin like an app icon's grid.
export const BRAND_ASSETS = {
  "apple-icon.png": { kind: "tile", markScale: 0.625, size: 180 },
  "icon-32.png": { kind: "tile", markScale: 0.75, size: 32 },
  "icon-192.png": { kind: "tile", markScale: 0.625, size: 192 },
  "icon-512.png": { kind: "tile", markScale: 0.625, size: 512 },
  "icon-maskable-512.png": { kind: "tile", markScale: 0.5, size: 512 },
  "icon.svg": { kind: "icon" },
  logo: { kind: "logo", theme: "light" },
  "logo-dark": { kind: "logo", theme: "dark" },
} as const satisfies Record<string, BrandAsset>;

export type BrandAssetName = keyof typeof BRAND_ASSETS;

export const brandAssetPath = (name: BrandAssetName): string =>
  `/brand/${name}`;

export const isBrandAssetName = (name: string): name is BrandAssetName =>
  Object.hasOwn(BRAND_ASSETS, name);

/**
 * The mark used when `brand:` names no logo or favicon: a speech bubble in
 * `currentColor`. `brand/logo.svg` at the repo root is the same file.
 */
export const PLACEHOLDER_MARK = `<svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path
    d="M7 3h10a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5h-5l-4.4 3.3c-.6.5-1.6 0-1.5-.8l.4-2.7A5 5 0 0 1 2 13V8a5 5 0 0 1 5-5z"
    fill="currentColor"
  />
</svg>
`;

/** `mask`: one colour, drawn in the theme's text colour. `image`: as it is. */
export type LogoMode = "image" | "mask";

// A colour named in an attribute (`fill="red"`) or a style (`fill: red`).
const COLOUR_PROPERTY =
  /\b(?:color|fill|flood-color|lighting-color|stop-color|stroke)\s*[=:]\s*["']?\s*([^"';\s>]+)/gi;
const NOT_A_COLOUR = new Set([
  "currentcolor",
  "inherit",
  "none",
  "transparent",
]);
const EMBEDDED_IMAGE = /<image\b/i;

export const logoModeOf = (image: BrandImage): LogoMode => {
  if (image.kind === "raster" || EMBEDDED_IMAGE.test(image.text)) {
    return "image";
  }
  for (const [, value = ""] of image.text.matchAll(COLOUR_PROPERTY)) {
    const named = value.toLowerCase();
    // A gradient or pattern's colours are on its stops, matched themselves.
    if (!(NOT_A_COLOUR.has(named) || named.startsWith("url("))) {
      return "image";
    }
  }
  return "mask";
};

/** What a file is served as: SVG text or raster bytes. */
export type BrandFile =
  | { readonly body: string; readonly type: "image/svg+xml" }
  | {
      readonly body: Uint8Array<ArrayBuffer>;
      readonly type: "image/jpeg" | "image/png";
    };

export const brandFile = (image: BrandImage): BrandFile =>
  image.kind === "svg"
    ? { body: image.text, type: "image/svg+xml" }
    : { body: image.data, type: image.mime };

const dataUri = (image: BrandImage): string => {
  const { body, type } = brandFile(image);
  return `data:${type};base64,${Buffer.from(body).toString("base64")}`;
};

/**
 * The tab icon: the mark inside an SVG of our own. A one-colour mark draws
 * black (an image's `currentColor`), inverted to white on dark tab strips.
 */
export const tabIcon = (icon: BrandImage): string => {
  const scheme =
    logoModeOf(icon) === "mask"
      ? "<style>@media (prefers-color-scheme:dark){image{filter:invert(1)}}</style>"
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${scheme}<image href="${dataUri(icon)}" width="64" height="64"/></svg>`;
};

/** The mark for a tile; a one-colour mark is inverted to white on it. */
export const tileMark = (
  icon: BrandImage
): { readonly invert: boolean; readonly src: string } => ({
  invert: logoModeOf(icon) === "mask",
  src: dataUri(icon),
});

/** The images `brand:` resolves to, each falling back as documented. */
export interface BrandImages {
  /** Tab and home-screen icons: the favicon, else the logo, else the placeholder. */
  readonly icon: BrandImage;
  /** The in-app logo for each theme; `null` when there's no logo. */
  readonly logo: Readonly<Record<BrandTheme, BrandImage>> | null;
}

export const PLACEHOLDER_IMAGES: BrandImages = {
  icon: { kind: "svg", text: PLACEHOLDER_MARK },
  logo: null,
};

export const brandImages = ({
  favicon,
  logo,
  logoDark,
}: {
  readonly favicon: BrandImage | null;
  readonly logo: BrandImage | null;
  readonly logoDark: BrandImage | null;
}): BrandImages => ({
  icon: favicon ?? logo ?? PLACEHOLDER_IMAGES.icon,
  logo: logo ? { dark: logoDark ?? logo, light: logo } : null,
});

/** How the app draws one theme's logo. */
export interface LogoView {
  readonly mode: LogoMode;
  readonly src: string;
}

/**
 * The logo to draw: `dark` is `null` when one drawing serves both themes (a
 * single file, so a mask follows the theme and an image is the same anyway).
 */
export interface LogoViews {
  readonly dark: LogoView | null;
  readonly light: LogoView;
}

export const logoViews = (logo: BrandImages["logo"]): LogoViews | null => {
  if (!logo) {
    return null;
  }
  const light = { mode: logoModeOf(logo.light), src: brandAssetPath("logo") };
  return {
    dark:
      logo.dark === logo.light
        ? null
        : { mode: logoModeOf(logo.dark), src: brandAssetPath("logo-dark") },
    light,
  };
};

/**
 * Makes each named asset once per process. A make that fails isn't kept:
 * this request gets the fallback, and the next one tries again.
 */
export const madeOnce = <K, T>(
  make: (name: K) => Promise<T>,
  fallback: (name: K, error: unknown) => Promise<T>
): ((name: K) => Promise<T>) => {
  const made = new Map<K, Promise<T>>();
  return (name) => {
    const cached = made.get(name);
    if (cached) {
      return cached;
    }
    const making = make(name).catch((error: unknown) => {
      made.delete(name);
      return fallback(name, error);
    });
    made.set(name, making);
    return making;
  };
};
