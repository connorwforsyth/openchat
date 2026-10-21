// The brand's files as the web app serves them (`apps/web/app/brand`), from
// whatever `brand:` names in app.config.yaml (D18). One SVG is enough: the
// logo stands in for the dark logo and the square icon, and a built-in mark
// stands in when there's no logo at all.
//
// The in-app logo follows the app's theme, not the OS: the client draws a
// paint layer (an <img>, the logo's own colours) over an ink layer (a CSS
// mask in the text colour). The server splits the logo between them, so the
// `currentColor` parts take the theme's colour and the rest keep their own.
// The tab icon can only follow the OS, so its `currentColor` switches with
// `prefers-color-scheme` inside the SVG. Home-screen icons can't be
// transparent, so they put the mark on a solid tile.

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
  /** One of the in-app logo's layers for one theme. */
  | {
      readonly kind: "logo";
      readonly layer: "ink" | "paint";
      readonly theme: BrandTheme;
    }
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
  logo: { kind: "logo", layer: "paint", theme: "light" },
  "logo-dark": { kind: "logo", layer: "paint", theme: "dark" },
  "logo-dark-ink": { kind: "logo", layer: "ink", theme: "dark" },
  "logo-ink": { kind: "logo", layer: "ink", theme: "light" },
} as const satisfies Record<string, BrandAsset>;

export type BrandAssetName = keyof typeof BRAND_ASSETS;

export const brandAssetPath = (name: BrandAssetName): string =>
  `/brand/${name}`;

export const brandAssetOf = (name: string): BrandAsset | undefined =>
  Object.hasOwn(BRAND_ASSETS, name)
    ? BRAND_ASSETS[name as BrandAssetName]
    : undefined;

/** The logo's two layers for each theme, for the client to draw. */
export const logoLayers = {
  dark: {
    ink: brandAssetPath("logo-dark-ink"),
    paint: brandAssetPath("logo-dark"),
  },
  light: { ink: brandAssetPath("logo-ink"), paint: brandAssetPath("logo") },
} as const satisfies Record<BrandTheme, Record<"ink" | "paint", string>>;

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

/** A fully transparent SVG: the ink layer of a logo with no `currentColor`. */
export const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

const CURRENT_COLOR = /currentcolor/i;
const SVG_OPEN_TAG = /<svg\b[^>]*>/i;

type SvgImage = Extract<BrandImage, { kind: "svg" }>;

const usesCurrentColor = (image: BrandImage): image is SvgImage =>
  image.kind === "svg" && CURRENT_COLOR.test(image.text);

/** The SVG with a stylesheet as its first child. */
const withStyle = (svg: string, css: string): string =>
  svg.replace(SVG_OPEN_TAG, (open) => `${open}<style>${css}</style>`);

/** What a file is served as: SVG text or raster bytes. */
export type BrandFile =
  | { readonly body: string; readonly type: "image/svg+xml" }
  | {
      readonly body: Uint8Array<ArrayBuffer>;
      readonly type: "image/jpeg" | "image/png";
    };

const asFile = (image: BrandImage): BrandFile =>
  image.kind === "svg"
    ? { body: image.text, type: "image/svg+xml" }
    : { body: image.data, type: image.mime };

const svgFile = (body: string): BrandFile => ({ body, type: "image/svg+xml" });

/**
 * One layer of the in-app logo. Paint is the logo with its `currentColor`
 * made transparent; ink is the logo when it uses `currentColor` (its shape
 * becomes the mask the theme colour shows through) and nothing otherwise.
 */
export const logoLayer = (
  logo: BrandImage,
  layer: "ink" | "paint"
): BrandFile => {
  if (!usesCurrentColor(logo)) {
    return layer === "ink" ? svgFile(EMPTY_SVG) : asFile(logo);
  }
  return layer === "ink"
    ? asFile(logo)
    : svgFile(withStyle(logo.text, "svg{color:transparent}"));
};

const dataUri = (image: BrandImage): string => {
  const { body, type } = asFile(image);
  return `data:${type};base64,${Buffer.from(body).toString("base64")}`;
};

/**
 * The tab icon. A `currentColor` mark is black on light tab strips and white
 * on dark ones; a raster is wrapped so the link is always an SVG.
 */
export const tabIcon = (icon: BrandImage): string => {
  if (icon.kind === "raster") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image href="${dataUri(icon)}" width="64" height="64"/></svg>`;
  }
  return CURRENT_COLOR.test(icon.text)
    ? withStyle(
        icon.text,
        "svg{color:black}@media (prefers-color-scheme:dark){svg{color:white}}"
      )
    : icon.text;
};

/** The mark as a data URI for a tile, its `currentColor` white on the tile. */
export const tileMark = (icon: BrandImage): string =>
  usesCurrentColor(icon)
    ? dataUri({ kind: "svg", text: withStyle(icon.text, "svg{color:white}") })
    : dataUri(icon);

/** The images `brand:` resolves to, each falling back as documented. */
export interface BrandImages {
  /** Tab and home-screen icons: the favicon, else the logo, else the placeholder. */
  readonly icon: BrandImage;
  /** The in-app logo for each theme; `null` when there's no logo. */
  readonly logo: Readonly<Record<BrandTheme, BrandImage>> | null;
}

export const brandImages = ({
  favicon,
  logo,
  logoDark,
}: {
  readonly favicon: BrandImage | null;
  readonly logo: BrandImage | null;
  readonly logoDark: BrandImage | null;
}): BrandImages => ({
  icon: favicon ?? logo ?? { kind: "svg", text: PLACEHOLDER_MARK },
  logo: logo ? { dark: logoDark ?? logo, light: logo } : null,
});
