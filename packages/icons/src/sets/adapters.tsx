import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types";

import type { IconProps } from "../types";

// Lucide's defaults, so swapping sets doesn't resize every icon without a
// `size-*` class.
const defaultSize = 24;

function hasAccessibleName(props: IconProps): boolean {
  return Boolean(
    props["aria-label"] ||
      props["aria-labelledby"] ||
      props.role ||
      props.children
  );
}

/**
 * Draws a Phosphor icon with the lucide prop surface: drops the stroke props
 * Phosphor's filled paths can't use, and hides decorative icons from assistive
 * tech the way lucide does. Each icon in `phosphor.ts` is a small component
 * calling this, so an icon nothing renders is dropped without any bundler hint.
 */
export function phosphorGlyph(
  {
    absoluteStrokeWidth: _absoluteStrokeWidth,
    nonScalingStroke: _nonScalingStroke,
    size = defaultSize,
    ...props
  }: IconProps,
  Glyph: PhosphorIcon
) {
  return (
    <Glyph
      aria-hidden={hasAccessibleName(props) ? undefined : true}
      size={size}
      {...props}
    />
  );
}

/**
 * Draws a Material Symbol from its path data (`material.glyphs.ts`) with the
 * lucide prop surface. Symbols are filled shapes in a 960-unit box, so they
 * paint with `fill` and ignore the stroke props. Each icon in `material.ts`
 * is a small component calling this, so an icon nothing renders is dropped
 * without any bundler hint.
 */
export function materialGlyph(
  {
    absoluteStrokeWidth: _absoluteStrokeWidth,
    children,
    nonScalingStroke: _nonScalingStroke,
    size = defaultSize,
    strokeWidth: _strokeWidth,
    ...props
  }: IconProps,
  path: string
) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative unless the caller names it (aria-label or a <title> child), as with lucide.
    <svg
      aria-hidden={hasAccessibleName({ children, ...props }) ? undefined : true}
      fill="currentColor"
      height={size}
      viewBox="0 -960 960 960"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
      <path d={path} />
    </svg>
  );
}
