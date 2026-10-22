import type { LogoView, LogoViews } from "@workspace/config/brand";
import { cn } from "@workspace/ui/lib/utils";

// The instance's logo, beside its name (so it's decorative: `alt=""`). A
// one-colour logo is a mask filled with the text colour, so it follows the
// app's theme; the hidden <img> inside only gives the box the logo's aspect
// ratio. Any other logo is drawn as it is, swapped for the dark logo on dark
// themes when there is one (packages/config/src/brand.ts).

const Mark = ({
  className,
  view,
}: {
  readonly className?: string;
  readonly view: LogoView;
}) =>
  view.mode === "mask" ? (
    <span
      className={cn("inline-flex shrink-0 bg-current", className)}
      style={{ mask: `url(${view.src}) center / contain no-repeat` }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/image needs fixed dimensions and doesn't optimise SVG */}
      {/* biome-ignore lint/correctness/useImageSize: the height is the caller's, the width the logo's own aspect ratio */}
      <img alt="" className="invisible h-full w-auto" src={view.src} />
    </span>
  ) : (
    // biome-ignore lint/performance/noImgElement: next/image needs fixed dimensions and doesn't optimise SVG
    // biome-ignore lint/correctness/useImageSize: the height is the caller's, the width the logo's own aspect ratio
    <img alt="" className={cn("w-auto shrink-0", className)} src={view.src} />
  );

export const BrandLogo = ({
  className,
  logo,
}: {
  /** Sets the height; the width follows the logo. */
  readonly className?: string;
  readonly logo: LogoViews | null;
}) => {
  if (!logo) {
    return null;
  }
  if (!logo.dark) {
    return <Mark className={className} view={logo.light} />;
  }
  return (
    <>
      <span className="contents dark:hidden">
        <Mark className={className} view={logo.light} />
      </span>
      <span className="hidden dark:contents">
        <Mark className={className} view={logo.dark} />
      </span>
    </>
  );
};
