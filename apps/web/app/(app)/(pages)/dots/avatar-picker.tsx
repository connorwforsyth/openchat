"use client";

import { useLingui } from "@lingui/react/macro";
import type {
  DotAvatarColor,
  DotAvatarStyle,
  DotAvatar as DotAvatarValue,
} from "@workspace/contract/schemas/dots";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useId, useMemo } from "react";

import {
  DOT_AVATAR_COLORS,
  DOT_AVATAR_STYLES,
  DotAvatar,
  type DotAvatarSize,
} from "./dot-avatar";

// Choosing a Dot's look (172): a shape and a colour, as native radios drawn
// as tiles, so arrow keys and Space work as they should.

/** The avatar choices' names, for their radios. */
export const useAvatarLabels = () => {
  const { t } = useLingui();
  return useMemo(
    () => ({
      colors: {
        bloom: t`Bloom`,
        dusk: t`Dusk`,
        ember: t`Ember`,
        moss: t`Moss`,
        sea: t`Sea`,
        sun: t`Sun`,
      } satisfies Record<DotAvatarColor, string>,
      styles: {
        blob: t`Blob`,
        orb: t`Orb`,
        pebble: t`Pebble`,
        ring: t`Ring`,
        spark: t`Spark`,
      } satisfies Record<DotAvatarStyle, string>,
    }),
    [t]
  );
};

function Choice<V extends string>({
  checked,
  children,
  compact,
  label,
  name,
  onSelect,
  value,
}: {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly compact: boolean;
  readonly label: string;
  readonly name: string;
  readonly onSelect: (value: V) => void;
  readonly value: V;
}) {
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-center justify-center border border-border transition-colors duration-(--motion-fast) hover:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
        compact ? "size-9 rounded-lg" : "size-14 rounded-xl",
        checked && "border-foreground bg-muted"
      )}
      title={label}
    >
      <input
        aria-label={label}
        checked={checked}
        className="sr-only"
        name={name}
        onChange={select}
        type="radio"
      />
      {children}
    </label>
  );
}

export function AvatarPicker({
  compact = false,
  onChange,
  value,
}: {
  /** Small tiles and no headings, for the edit dialog. */
  readonly compact?: boolean;
  readonly onChange: (avatar: DotAvatarValue) => void;
  readonly value: DotAvatarValue;
}) {
  const { t } = useLingui();
  const ids = useId();
  const labels = useAvatarLabels();
  const pickStyle = useCallback(
    (style: DotAvatarStyle) => onChange({ ...value, style }),
    [onChange, value]
  );
  const pickColor = useCallback(
    (color: DotAvatarColor) => onChange({ ...value, color }),
    [onChange, value]
  );
  const shapeSize: DotAvatarSize = compact ? "sm" : "md";
  const legend = cn(
    "font-medium text-sm",
    compact ? "sr-only" : "mb-2 text-start"
  );
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col">
        <legend className={legend}>{t`Shape`}</legend>
        <div className="flex flex-wrap gap-2">
          {DOT_AVATAR_STYLES.map((style) => (
            <Choice
              checked={value.style === style}
              compact={compact}
              key={style}
              label={labels.styles[style]}
              name={`${ids}-style`}
              onSelect={pickStyle}
              value={style}
            >
              <DotAvatar
                animated={false}
                avatar={{ color: value.color, style }}
                size={shapeSize}
              />
            </Choice>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col">
        <legend className={legend}>{t`Colour`}</legend>
        <div className="flex flex-wrap gap-2">
          {DOT_AVATAR_COLORS.map((color) => (
            <Choice
              checked={value.color === color}
              compact={compact}
              key={color}
              label={labels.colors[color]}
              name={`${ids}-color`}
              onSelect={pickColor}
              value={color}
            >
              <DotAvatar
                animated={false}
                avatar={{ color, style: "orb" }}
                size={compact ? "xs" : "sm"}
              />
            </Choice>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
