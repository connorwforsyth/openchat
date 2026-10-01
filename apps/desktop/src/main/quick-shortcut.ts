import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { comboToAccelerator } from "@workspace/shortcuts/electron";
import {
  formatCombo,
  formatParsedCombo,
  parseCombo,
} from "@workspace/shortcuts/keys";
import { z } from "zod";

import type { Platform } from "../shared/ipc";

// The Quick AI window's global shortcut (118). It's kept in settings.json
// in the registry's notation (`Alt+Space`, `Mod+Shift+Space`), so it reads
// the same as the web app's shortcuts, and becomes an Electron accelerator
// here. Pure: main registers it and reports what happened.

/** ⌥Space, as in the ticket. */
export const DEFAULT_QUICK_SHORTCUT = "Alt+Space";

/** The shortcuts the menu offers; the settings file can name any other. */
export const QUICK_SHORTCUT_PRESETS: readonly string[] = [
  "Alt+Space",
  "Ctrl+Space",
  "Mod+Alt+Space",
  "Mod+Shift+Space",
];

/**
 * The setting as stored: a combo, or `null` for no global shortcut (Quick
 * AI is then on the menu and the tray only).
 */
export const quickShortcutSettingSchema = z.string().max(40).nullable();
export type QuickShortcutSetting = z.infer<typeof quickShortcutSettingSchema>;

export const quickShortcutErrorSchema = z.enum([
  // Not a key combo at all.
  "invalid",
  // A combo, but one that types text (no ⌘, Ctrl or ⌥): as a global
  // shortcut it would swallow that key in every app.
  "needs-modifier",
]);
export type QuickShortcutError = z.infer<typeof quickShortcutErrorSchema>;

export type QuickShortcut =
  | { readonly kind: "off" }
  | {
      readonly accelerator: string;
      /** In canonical form, as the menu compares it. */
      readonly combo: string;
      readonly kind: "on";
    }
  | {
      /** What the settings file said. */
      readonly combo: string;
      readonly error: QuickShortcutError;
      readonly kind: "invalid";
    };

/**
 * Modifier names someone might write by hand, in any case, as the
 * registry's. `Cmd` is `Mod`: ⌘ on macOS, Ctrl elsewhere, as Electron's
 * `CommandOrControl`.
 */
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  alt: "Alt",
  cmd: "Mod",
  cmdorctrl: "Mod",
  command: "Mod",
  commandorcontrol: "Mod",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Meta",
  mod: "Mod",
  option: "Alt",
  shift: "Shift",
  super: "Meta",
};

/** `shift+cmd+space` → `Shift+Mod+Space`: modifiers by name, the key as written. */
const normaliseModifiers = (setting: string): string => {
  const parts = setting.trim().split("+");
  return parts
    .map((part, index) =>
      index < parts.length - 1
        ? (MODIFIER_ALIASES[part.trim().toLowerCase()] ?? part)
        : part
    )
    .join("+");
};

/** Reads the setting: off, a shortcut to register, or why it can't be one. */
export const parseQuickShortcut = (
  setting: QuickShortcutSetting
): QuickShortcut => {
  if (setting === null) {
    return { kind: "off" };
  }
  const parsed = parseCombo(normaliseModifiers(setting));
  if (!parsed.ok) {
    return { combo: setting, error: "invalid", kind: "invalid" };
  }
  const combo = formatParsedCombo(parsed.value);
  const accelerator = comboToAccelerator(combo);
  return accelerator
    ? { accelerator, combo, kind: "on" }
    : { combo: setting, error: "needs-modifier", kind: "invalid" };
};

/** `⌥Space` on macOS, `Alt+Space` elsewhere. */
export const shortcutLabel = (combo: string, platform: Platform): string =>
  formatCombo(combo, platform === "win" ? "windows" : platform);

/**
 * What registering the shortcut came to, for main to tell the person:
 * `null` when there's nothing to say.
 */
export type RegistrationOutcome =
  | { readonly kind: "registered" }
  | { readonly kind: "off" }
  | { readonly kind: "invalid"; readonly shortcut: QuickShortcut }
  | { readonly combo: string; readonly kind: "taken" };

/**
 * The message for a shortcut that couldn't be used. Quick AI stays on the
 * menu bar icon and the app menu either way.
 */
export const registrationMessage = (
  outcome: RegistrationOutcome,
  { i18n, platform }: { readonly i18n: I18n; readonly platform: Platform }
): { readonly detail: string; readonly message: string } | null => {
  const fallback = i18n._(
    msg`Quick AI is still in the menu bar and the app menu. Choose another shortcut under Quick AI Shortcut.`
  );
  switch (outcome.kind) {
    case "registered":
    case "off":
      return null;
    case "taken": {
      const keys = shortcutLabel(outcome.combo, platform);
      return {
        detail: fallback,
        message: i18n._(
          msg`Another app is using ${keys}, so it can't open Quick AI.`
        ),
      };
    }
    case "invalid": {
      const { shortcut } = outcome;
      const combo = shortcut.kind === "invalid" ? shortcut.combo : "";
      return {
        detail: fallback,
        message: i18n._(
          msg`The Quick AI shortcut "${combo}" in settings.json isn't one that can be used. It needs ⌘, Ctrl or ⌥ and a key, like Alt+Space.`
        ),
      };
    }
    default:
      return outcome satisfies never;
  }
};

/** Electron's `globalShortcut`, as far as Quick AI uses it. */
export interface GlobalShortcutPort {
  /** `false` when another app holds the keys. */
  readonly register: (accelerator: string, onPress: () => void) => boolean;
  readonly unregister: (accelerator: string) => void;
}

/**
 * Swaps the registered shortcut for `next`: releases `previous`, then
 * registers `next` and says how that went. A shortcut that can't be had
 * leaves none registered, and Quick AI on the menus.
 */
export const applyQuickShortcut = ({
  next,
  onPress,
  port,
  previous,
}: {
  readonly next: QuickShortcut;
  readonly onPress: () => void;
  readonly port: GlobalShortcutPort;
  /** What's registered now, if anything. */
  readonly previous: QuickShortcut | null;
}): RegistrationOutcome => {
  if (previous?.kind === "on") {
    port.unregister(previous.accelerator);
  }
  switch (next.kind) {
    case "off":
      return { kind: "off" };
    case "invalid":
      return { kind: "invalid", shortcut: next };
    case "on": {
      let registered = false;
      try {
        registered = port.register(next.accelerator, onPress);
      } catch {
        // Electron throws on an accelerator it can't read; parsing should
        // have caught it, so treat it as one that can't be used.
        return {
          kind: "invalid",
          shortcut: { combo: next.combo, error: "invalid", kind: "invalid" },
        };
      }
      return registered
        ? { kind: "registered" }
        : { combo: next.combo, kind: "taken" };
    }
    default:
      return next satisfies never;
  }
};
