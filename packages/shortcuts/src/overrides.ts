import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { keyComboSchema } from "./keys";
import {
  type ShortcutDefinition,
  type ShortcutId,
  scopesOverlap,
  shortcutIdSchema,
  shortcutRegistry,
} from "./registry";

// User-recorded shortcuts (D10). A user's overrides are a sparse map from id
// to combos: a missing id means "the default", an empty list means "off".
// Everything here is pure; persistence is the `OverridesStore` port.

export const shortcutOverridesSchema = z.partialRecord(
  shortcutIdSchema,
  z.array(keyComboSchema).max(3)
);
export type ShortcutOverrides = z.infer<typeof shortcutOverridesSchema>;

/** Each id's live combos after overrides. */
export type ShortcutBindings = ReadonlyMap<ShortcutId, readonly string[]>;

export const resolveBindings = (
  overrides: ShortcutOverrides,
  registry: readonly ShortcutDefinition[] = shortcutRegistry
): ShortcutBindings =>
  new Map(
    registry.map((definition) => [
      definition.id,
      overrides[definition.id] ?? definition.keys,
    ])
  );

/** Whether the user changed this shortcut from its default. */
export const isOverridden = (
  overrides: ShortcutOverrides,
  id: ShortcutId
): boolean => overrides[id] !== undefined;

export const setOverride = (
  overrides: ShortcutOverrides,
  id: ShortcutId,
  keys: readonly string[]
): ShortcutOverrides => ({ ...overrides, [id]: [...keys] });

export const resetOverride = (
  overrides: ShortcutOverrides,
  id: ShortcutId
): ShortcutOverrides =>
  parseOverrides(
    Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id))
  );

/**
 * Combos the browser or OS keeps for itself: a page can't reliably receive
 * them, and taking the ones it can (⌘W, ⌘T) would surprise people.
 */
export const RESERVED_COMBOS: ReadonlySet<string> = new Set([
  "Mod+W",
  "Mod+T",
  "Mod+N",
  "Mod+Q",
  "Mod+Shift+T",
  "Mod+Shift+N",
  "Mod+L",
  "Mod+R",
  "Mod+Tab",
  "Ctrl+Tab",
  "Mod+Shift+C",
  "Mod+Alt+I",
]);

export const recordingErrorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("invalid") }),
  z.object({ type: z.literal("reserved") }),
  z.object({ id: shortcutIdSchema, type: z.literal("conflict") }),
]);
export type RecordingError = z.infer<typeof recordingErrorSchema>;

/**
 * Checks a freshly recorded combo for `id`: it must parse, not be reserved,
 * and not clash with another shortcut live in an overlapping scope.
 */
export const checkRecording = (
  bindings: ShortcutBindings,
  id: ShortcutId,
  combo: string,
  registry: readonly ShortcutDefinition[] = shortcutRegistry
): Result<string, RecordingError> => {
  const parsed = keyComboSchema.safeParse(combo);
  if (!parsed.success) {
    return err({ type: "invalid" });
  }
  const normalised = parsed.data;
  if (RESERVED_COMBOS.has(normalised)) {
    return err({ type: "reserved" });
  }
  const scope = registry.find((each) => each.id === id)?.scope ?? "global";
  const clash = registry.find(
    (other) =>
      other.id !== id &&
      scopesOverlap(scope, other.scope) &&
      (bindings.get(other.id) ?? []).includes(normalised)
  );
  return clash ? err({ id: clash.id, type: "conflict" }) : ok(normalised);
};

export interface ShortcutConflict {
  readonly combo: string;
  readonly ids: readonly [ShortcutId, ShortcutId];
}

/** Every pair of live shortcuts that share a combo in overlapping scopes. */
export const findConflicts = (
  bindings: ShortcutBindings,
  registry: readonly ShortcutDefinition[] = shortcutRegistry
): readonly ShortcutConflict[] =>
  registry.flatMap((a, index) =>
    registry
      .slice(index + 1)
      .flatMap((b) =>
        scopesOverlap(a.scope, b.scope)
          ? (bindings.get(a.id) ?? [])
              .filter((combo) => (bindings.get(b.id) ?? []).includes(combo))
              .map((combo) => ({ combo, ids: [a.id, b.id] as const }))
          : []
      )
  );

/** Parses stored overrides leniently: bad entries are dropped, never fatal. */
export const parseOverrides = (value: unknown): ShortcutOverrides => {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const entries = Object.entries(value).flatMap(([key, keys]) => {
    const id = shortcutIdSchema.safeParse(key);
    const combos = z.array(keyComboSchema).max(3).safeParse(keys);
    return id.success && combos.success
      ? [[id.data, combos.data] as const]
      : [];
  });
  return Object.fromEntries(entries);
};
