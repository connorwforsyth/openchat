"use client";

import { Kbd, KbdGroup } from "@workspace/ui/components/kbd";

import { usePlatform } from "../shell/platform";
import { type ShortcutId, shortcutById, shortcutKeys } from "./registry";

/** The keys for a shortcut as Kbd chips, e.g. in a tooltip or menu item. */
export function ShortcutHint({
  className,
  id,
}: {
  readonly className?: string;
  readonly id: ShortcutId;
}) {
  const { isApple } = usePlatform();
  const keys = shortcutKeys(shortcutById(id), isApple);
  return (
    <KbdGroup aria-hidden className={className}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
