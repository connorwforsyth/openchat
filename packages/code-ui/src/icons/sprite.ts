import { err, ok, type Result } from "@workspace/shared/result";

// @pierre/trees draws its icons from an SVG sprite (`<symbol>`s in its shadow
// root). D19 says that sprite comes from the active icon set, so the tree
// renders icons through `@workspace/icons` like everything else and these
// helpers turn the rendered `<svg>` markup into symbols.

const SVG_ELEMENT = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;

// Root attributes that paint the children. A `<symbol>` doesn't inherit them
// from the `<svg>` it replaces, so they move onto a wrapping `<g>`.
const PRESENTATION = new Set([
  "clip-rule",
  "fill",
  "fill-rule",
  "stroke",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-width",
]);

export interface SpriteError {
  readonly id: string;
  readonly kind: "not-svg";
}

/** Converts one rendered icon (`<svg …>…</svg>`) into a `<symbol>` with `id`. */
export function svgToSymbol(
  svg: string,
  id: string
): Result<string, SpriteError> {
  const match = SVG_ELEMENT.exec(svg);
  if (match === null) {
    return err({ id, kind: "not-svg" });
  }
  const [, rawAttributes = "", inner = ""] = match;
  const attributes = new Map(
    [...rawAttributes.matchAll(ATTRIBUTE)].map(
      ([, name = "", value = ""]) => [name, value] as const
    )
  );
  const paint = [...attributes]
    .filter(([name]) => PRESENTATION.has(name))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  const viewBox = attributes.get("viewBox") ?? "0 0 24 24";
  return ok(
    `<symbol id="${id}" viewBox="${viewBox}"><g${paint}>${inner}</g></symbol>`
  );
}

/** Wraps symbols in the hidden sprite element @pierre/trees expects. */
export function spriteSheet(symbols: readonly string[]): string {
  return `<svg data-icon-sprite aria-hidden="true" width="0" height="0">${symbols.join("")}</svg>`;
}
