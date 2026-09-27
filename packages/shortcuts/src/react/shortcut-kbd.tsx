"use client";

import { Kbd, KbdGroup } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";

import { comboKeycaps } from "../keys";
import type { ShortcutId } from "../registry";
import { useShortcuts } from "./context";
import { useShortcutHint } from "./use-shortcut";

// Kbd hints for controls (009: "Kbd hints on controls"). They read the live
// bindings, so a recorded shortcut shows up everywhere at once.

export interface ComboKbdProps {
  readonly className?: string;
  readonly combo: string;
}

/** A literal combo as keycaps, platform-aware. */
export const ComboKbd = ({ className, combo }: ComboKbdProps) => {
  const { platform } = useShortcuts();
  const keycaps = comboKeycaps(combo, platform);
  return (
    <KbdGroup className={className}>
      {keycaps.map((keycap) => (
        <Kbd key={keycap}>{keycap}</Kbd>
      ))}
    </KbdGroup>
  );
};

export interface ShortcutKbdProps {
  readonly className?: string;
  readonly id: ShortcutId;
}

/** A shortcut's current keys; renders nothing when the user switched it off. */
export const ShortcutKbd = ({ className, id }: ShortcutKbdProps) => {
  const { combo } = useShortcutHint(id);
  return combo ? (
    <ComboKbd className={cn("shrink-0", className)} combo={combo} />
  ) : null;
};
