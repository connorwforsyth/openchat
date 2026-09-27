import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// Key combos as data. The string form is TanStack Hotkeys' (`Mod+K`, `Shift+/`,
// `?`, `[`), so the library can consume it directly, but parsing, display and
// matching live here as pure functions: the registry, the `?` dialog, Kbd
// hints and Electron accelerators all need them without a DOM, and a swap to
// another hotkey library (D10) must not change what a stored combo means.

export const platformSchema = z.enum(["mac", "windows", "linux"]);
export type Platform = z.infer<typeof platformSchema>;

/** `Mod` is ⌘ on macOS and Ctrl elsewhere, so one registry serves both. */
export const modifierSchema = z.enum(["Mod", "Ctrl", "Meta", "Alt", "Shift"]);
export type Modifier = z.infer<typeof modifierSchema>;

/** Named keys a combo may end in, besides single printable characters. */
const NAMED_KEYS = [
  "Escape",
  "Enter",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
] as const;
const namedKeys: ReadonlySet<string> = new Set(NAMED_KEYS);

export const keyComboErrorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("empty") }),
  z.object({ modifier: z.string(), type: z.literal("unknown_modifier") }),
  z.object({ modifier: modifierSchema, type: z.literal("duplicate_modifier") }),
  z.object({ key: z.string(), type: z.literal("unknown_key") }),
  z.object({ type: z.literal("modifier_only") }),
]);
export type KeyComboError = z.infer<typeof keyComboErrorSchema>;

export const parsedComboSchema = z.object({
  /** A single character upper-cased (`K`), punctuation as typed (`?`), or a named key. */
  key: z.string().min(1),
  modifiers: z.array(modifierSchema),
});
export type ParsedCombo = z.infer<typeof parsedComboSchema>;

/** Stable order so `Shift+Mod+K` and `Mod+Shift+K` are the same combo. */
const MODIFIER_ORDER: readonly Modifier[] = [
  "Mod",
  "Ctrl",
  "Meta",
  "Alt",
  "Shift",
];

const isModifier = (value: string): value is Modifier =>
  modifierSchema.safeParse(value).success;

const normaliseKey = (raw: string): Result<string, KeyComboError> => {
  if (raw.length === 1) {
    return ok(raw.toUpperCase());
  }
  const named = NAMED_KEYS.find(
    (name) => name.toLowerCase() === raw.toLowerCase()
  );
  if (named) {
    return ok(named);
  }
  if (raw.toLowerCase() === "esc") {
    return ok("Escape");
  }
  return err({ key: raw, type: "unknown_key" });
};

/** Splits `Mod+Shift+K` (and `Mod++`, whose key is `+`) into parts. */
const splitCombo = (combo: string): string[] => {
  if (combo === "+") {
    return ["+"];
  }
  if (combo.endsWith("++")) {
    return [...combo.slice(0, -2).split("+"), "+"];
  }
  return combo.split("+");
};

export const parseCombo = (
  combo: string
): Result<ParsedCombo, KeyComboError> => {
  const trimmed = combo.trim();
  if (trimmed.length === 0) {
    return err({ type: "empty" });
  }
  const parts = splitCombo(trimmed);
  const last = parts.at(-1) ?? "";
  if (isModifier(last)) {
    return err({ type: "modifier_only" });
  }
  const modifiers: Modifier[] = [];
  for (const part of parts.slice(0, -1)) {
    if (!isModifier(part)) {
      return err({ modifier: part, type: "unknown_modifier" });
    }
    if (modifiers.includes(part)) {
      return err({ modifier: part, type: "duplicate_modifier" });
    }
    modifiers.push(part);
  }
  const key = normaliseKey(last);
  if (!key.ok) {
    return key;
  }
  return ok({
    key: key.value,
    modifiers: MODIFIER_ORDER.filter((each) => modifiers.includes(each)),
  });
};

export const formatParsedCombo = ({ key, modifiers }: ParsedCombo): string =>
  [...modifiers, key].join("+");

/** A combo in canonical form, or unchanged when it doesn't parse. */
export const normaliseCombo = (combo: string): string => {
  const parsed = parseCombo(combo);
  return parsed.ok ? formatParsedCombo(parsed.value) : combo;
};

export const keyComboSchema = z
  .string()
  .max(40)
  .refine((combo) => parseCombo(combo).ok, "not a key combo, like `Mod+K`")
  .transform(normaliseCombo);
export type KeyCombo = z.infer<typeof keyComboSchema>;

/** The OS modifier `Mod` stands for. */
const resolveModifier = (modifier: Modifier, platform: Platform): Modifier => {
  if (modifier !== "Mod") {
    return modifier;
  }
  return platform === "mac" ? "Meta" : "Ctrl";
};

/**
 * Single keys and Shift-only combos fire only outside text fields (009: "when
 * focus isn't in a text field"); anything with Ctrl, ⌘, Alt or Escape works
 * everywhere, because typing never produces it.
 */
export const worksWhileTyping = (combo: string): boolean => {
  const parsed = parseCombo(combo);
  if (!parsed.ok) {
    return false;
  }
  if (parsed.value.key === "Escape") {
    return true;
  }
  return parsed.value.modifiers.some((modifier) => modifier !== "Shift");
};

const MAC_SYMBOLS: Record<Modifier, string> = {
  Alt: "⌥",
  Ctrl: "⌃",
  Meta: "⌘",
  Mod: "⌘",
  Shift: "⇧",
};

const PC_LABELS: Record<Modifier, string> = {
  Alt: "Alt",
  Ctrl: "Ctrl",
  Meta: "Win",
  Mod: "Ctrl",
  Shift: "Shift",
};

const MAC_KEYS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↩",
  Escape: "Esc",
  Space: "Space",
  Tab: "⇥",
};

const PC_KEYS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Escape: "Esc",
};

/**
 * The combo as the separate keycaps to draw, platform-aware: `["⌘", "K"]` on
 * macOS, `["Ctrl", "K"]` elsewhere. Empty for a combo that doesn't parse.
 */
export const comboKeycaps = (
  combo: string,
  platform: Platform
): readonly string[] => {
  const parsed = parseCombo(combo);
  if (!parsed.ok) {
    return [];
  }
  const { key, modifiers } = parsed.value;
  const mac = platform === "mac";
  const labels = modifiers.map((modifier) =>
    mac ? MAC_SYMBOLS[modifier] : PC_LABELS[modifier]
  );
  return [...labels, (mac ? MAC_KEYS[key] : PC_KEYS[key]) ?? key];
};

/** One string for tooltips and menus: `⌘K` on macOS, `Ctrl+K` elsewhere. */
export const formatCombo = (combo: string, platform: Platform): string =>
  comboKeycaps(combo, platform).join(platform === "mac" ? "" : "+");

const APPLE_AGENT = /Mac|iPhone|iPad|iPod/i;
const WINDOWS_AGENT = /Win/i;
const LETTER_OR_DIGIT = /^[A-Z0-9]$/;

/** The platform from a user agent; `linux` when nothing matches, since it has no ⌘. */
export const platformFromUserAgent = (userAgent: string): Platform => {
  if (APPLE_AGENT.test(userAgent)) {
    return "mac";
  }
  if (WINDOWS_AGENT.test(userAgent)) {
    return "windows";
  }
  return "linux";
};

/** The subset of `KeyboardEvent` matching needs, so tests pass plain objects. */
export interface KeyEventLike {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Whether a keydown matches a combo. Punctuation matches by the character it
 * produced (`?` is Shift+/ on a US layout and something else elsewhere), so
 * Shift is only compared when the combo names it or the key is a letter.
 */
export const matchesCombo = (
  event: KeyEventLike,
  combo: string,
  platform: Platform
): boolean => {
  const parsed = parseCombo(combo);
  if (!parsed.ok) {
    return false;
  }
  const { key, modifiers } = parsed.value;
  const wanted = new Set(
    modifiers.map((modifier) => resolveModifier(modifier, platform))
  );
  const eventKey = normaliseKey(event.key === " " ? "Space" : event.key);
  if (!eventKey.ok || eventKey.value !== key) {
    return false;
  }
  const letterOrNamed = LETTER_OR_DIGIT.test(key) || namedKeys.has(key);
  const shiftMatters = wanted.has("Shift") || letterOrNamed;
  return (
    event.ctrlKey === wanted.has("Ctrl") &&
    event.metaKey === wanted.has("Meta") &&
    event.altKey === wanted.has("Alt") &&
    (!shiftMatters || event.shiftKey === wanted.has("Shift"))
  );
};

/** Text inputs, textareas, selects and contenteditable regions (the composer). */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "reset", "submit"].includes(
      target.type
    );
  }
  return target instanceof HTMLTextAreaElement || target.tagName === "SELECT";
};
