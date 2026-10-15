import type {
  DotAvatarColor,
  DotAvatarStyle,
  DotAvatar as DotAvatarValue,
} from "@workspace/contract/schemas/dots";
import { cn } from "@workspace/ui/lib/utils";

// A Dot's face (172): a small CSS creature in one of the theme's `--dot-*`
// colours. Its idle life is a slow breath (and, for some shapes, a drift):
// transform and opacity only, behind `motion-safe:` so reduced motion holds
// it still. Decorative: the Dot's name is always next to it.

export const DOT_AVATAR_STYLES = [
  "orb",
  "blob",
  "ring",
  "spark",
  "pebble",
] as const satisfies readonly DotAvatarStyle[];

export const DOT_AVATAR_COLORS = [
  "sea",
  "dusk",
  "bloom",
  "ember",
  "sun",
  "moss",
] as const satisfies readonly DotAvatarColor[];

// Literal class names, so Tailwind sees every one.
const FILL: Readonly<Record<DotAvatarColor, string>> = {
  bloom: "bg-dot-bloom",
  dusk: "bg-dot-dusk",
  ember: "bg-dot-ember",
  moss: "bg-dot-moss",
  sea: "bg-dot-sea",
  sun: "bg-dot-sun",
};

const RING: Readonly<Record<DotAvatarColor, string>> = {
  bloom: "border-dot-bloom",
  dusk: "border-dot-dusk",
  ember: "border-dot-ember",
  moss: "border-dot-moss",
  sea: "border-dot-sea",
  sun: "border-dot-sun",
};

const SIZE = {
  lg: "size-16",
  md: "size-9",
  sm: "size-6",
  xl: "size-24",
  xs: "size-4",
} as const;

export type DotAvatarSize = keyof typeof SIZE;

/** The shape's own layers; sized by the wrapper. */
function Shape({
  color,
  style,
}: {
  readonly color: DotAvatarColor;
  readonly style: DotAvatarStyle;
}) {
  const fill = FILL[color];
  switch (style) {
    case "orb":
      return (
        <>
          <span className={cn("absolute inset-0 rounded-full", fill)} />
          {/* The highlight: the theme's background, softly. */}
          <span className="absolute start-[22%] top-[18%] size-[28%] rounded-full bg-background/45" />
        </>
      );
    case "blob":
      return (
        <span
          className={cn(
            "absolute inset-[4%] rounded-[58%_42%_55%_45%/45%_55%_45%_55%] motion-safe:animate-dot-drift",
            fill
          )}
        />
      );
    case "ring":
      return (
        <>
          <span
            className={cn(
              "absolute inset-0 rounded-full border-[3px]",
              RING[color]
            )}
          />
          <span className={cn("absolute inset-[32%] rounded-full", fill)} />
        </>
      );
    case "spark":
      return (
        <span
          className={cn(
            "absolute inset-[16%] rotate-45 rounded-[30%] motion-safe:animate-dot-drift",
            fill
          )}
        />
      );
    case "pebble":
      return (
        <>
          <span
            className={cn(
              "absolute inset-x-0 inset-y-[10%] rounded-[45%]",
              fill
            )}
          />
          <span className="absolute inset-x-[30%] top-[28%] h-[10%] rounded-full bg-background/40" />
        </>
      );
    default:
      return style satisfies never;
  }
}

export function DotAvatar({
  animated = true,
  avatar,
  className,
  size = "md",
}: {
  /** Off where many show at once and motion would be noise (lists). */
  readonly animated?: boolean;
  readonly avatar: DotAvatarValue;
  readonly className?: string;
  readonly size?: DotAvatarSize;
}) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0", SIZE[size], className)}
      data-slot="dot-avatar"
      data-style={avatar.style}
    >
      <span
        className={cn(
          "absolute inset-0",
          animated && "motion-safe:animate-dot-breathe"
        )}
      >
        <Shape color={avatar.color} style={avatar.style} />
      </span>
    </span>
  );
}
