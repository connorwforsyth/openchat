import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types";

import type { Icon, IconProps } from "../types";

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
 * Wraps a Phosphor icon in the lucide prop surface: drops the stroke props
 * Phosphor's filled paths can't use, and hides decorative icons from assistive
 * tech the way lucide does.
 */
export function fromPhosphor(Glyph: PhosphorIcon): Icon {
  function PhosphorGlyph({
    absoluteStrokeWidth: _absoluteStrokeWidth,
    nonScalingStroke: _nonScalingStroke,
    size = defaultSize,
    ...props
  }: IconProps) {
    return (
      <Glyph
        aria-hidden={hasAccessibleName(props) ? undefined : true}
        size={size}
        {...props}
      />
    );
  }
  PhosphorGlyph.displayName = Glyph.displayName;
  return PhosphorGlyph;
}
