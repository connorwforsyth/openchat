import { type BrandTheme, logoLayers } from "@workspace/config/brand";
import { cn } from "@workspace/ui/lib/utils";

// The instance's logo, beside its name (so it's decorative: `alt=""`). It
// follows the app's theme, not the OS: each theme's paint layer is the logo's
// own colours, over an ink layer that shows the text colour through the
// logo's `currentColor` shape (packages/config/src/brand.ts).

const Layers = ({
  className,
  theme,
}: {
  readonly className: string;
  readonly theme: BrandTheme;
}) => {
  const { ink, paint } = logoLayers[theme];
  return (
    <span className={cn("relative shrink-0", className)}>
      <span
        aria-hidden
        className="absolute inset-0 bg-current"
        style={{ mask: `url(${ink}) center / contain no-repeat` }}
      />
      {/* biome-ignore lint/performance/noImgElement: next/image needs fixed dimensions and doesn't optimise SVG */}
      {/* biome-ignore lint/correctness/useImageSize: the height is the caller's, the width the logo's own aspect ratio */}
      <img alt="" className="relative h-full w-auto" src={paint} />
    </span>
  );
};

export const BrandLogo = ({
  className,
  logoUrl,
}: {
  /** Sets the height; the width follows the logo. */
  readonly className?: string;
  /** `brand.logoUrl` from the public config: no logo, nothing drawn. */
  readonly logoUrl: string | null;
}) =>
  logoUrl ? (
    <>
      <Layers className={cn("flex dark:hidden", className)} theme="light" />
      <Layers className={cn("hidden dark:flex", className)} theme="dark" />
    </>
  ) : null;
