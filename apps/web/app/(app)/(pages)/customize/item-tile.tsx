import { cn } from "@workspace/ui/lib/utils";

// A server's or skill's tile (193): its emoji when it has one, else its
// first letter, so a long list scans by shape. An icon registry name (the
// library's other kind of `icon`) reads as no emoji: the letter shows.

const REGISTRY_NAME = /^[a-z0-9-]+$/i;

export const tileGlyph = (name: string, icon: string | null): string =>
  icon && !REGISTRY_NAME.test(icon) ? icon : name.slice(0, 1).toUpperCase();

const sizes = {
  lg: "size-16 rounded-2xl text-2xl",
  md: "size-10 rounded-xl text-base",
  sm: "size-5 rounded-md text-[0.6875rem]",
} as const;

export const ItemTile = ({
  icon = null,
  name,
  size = "sm",
}: {
  readonly icon?: string | null;
  readonly name: string;
  readonly size?: keyof typeof sizes;
}) => (
  <span
    aria-hidden
    className={cn(
      "flex shrink-0 items-center justify-center border bg-muted font-medium text-muted-foreground",
      sizes[size]
    )}
    data-slot="item-tile"
  >
    {tileGlyph(name, icon)}
  </span>
);
