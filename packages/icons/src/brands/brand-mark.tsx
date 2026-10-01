import type { IconProps } from "../types";
import { brandOf } from "./brands";
import type { Mark } from "./codegen";
import { marks } from "./marks.generated";

/** The mark for a vendor id (`anthropic`), if `brands.ts` gives it one. */
export const brandMark = (id: string): Mark | undefined => {
  const name = brandOf(id)?.mark;
  return name === undefined ? undefined : marks[name];
};

/** Whether `id` has a mark; without one, callers draw their own fallback. */
export const hasBrandMark = (id: string): boolean =>
  brandMark(id) !== undefined;

/** A vendor id as people know it (`openai` is OpenAI); unknown ids as written. */
export const brandName = (id: string): string => brandOf(id)?.name ?? id;

export type BrandMarkProps = Omit<IconProps, "children"> & {
  /** A vendor id from `brands.ts`. */
  readonly brand: string;
};

/**
 * A vendor's monochrome logo in `currentColor`, sized like any other icon
 * (lucide's `size` prop, 24 by default, or a `size-*` class). Decorative:
 * the row it sits in names the vendor. Renders nothing for an id with no
 * mark, so the caller's fallback shows instead.
 */
export function BrandMark({
  brand,
  size = 24,
  absoluteStrokeWidth: _absolute,
  nonScalingStroke: _nonScaling,
  ...props
}: BrandMarkProps) {
  const mark = brandMark(brand);
  if (mark === undefined) {
    return null;
  }
  return (
    <svg
      aria-hidden
      data-brand={brand}
      fill="currentColor"
      focusable="false"
      height={size}
      viewBox={mark.viewBox}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {mark.paths.map((path) => (
        <path
          clipRule={path.clipRule}
          d={path.d}
          fillOpacity={path.fillOpacity}
          fillRule={path.fillRule}
          key={path.d}
        />
      ))}
    </svg>
  );
}
