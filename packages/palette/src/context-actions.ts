import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { type PaletteAction, paletteAction } from "./items";

// Context-aware actions (D14): what the palette offers depends on where it
// was opened. Each capability is optional; a surface passes only what it can
// do (the web chat has no permission modes, the settings page has no model).

export interface PaletteOption {
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
}

export interface PaletteChoice {
  /** The option in effect, which is left out of the list. */
  readonly current: string | null;
  readonly onSelect: (id: string) => void;
  readonly options: readonly PaletteOption[];
}

export interface PaletteContext {
  /** Chat context (Personal / team / org). Locked after the first message (D17). */
  readonly chatContext?: PaletteChoice & { readonly locked: boolean };
  readonly model?: PaletteChoice;
  /** Cowork permission modes (desktop). */
  readonly permissionMode?: PaletteChoice;
  readonly sandbox?: {
    readonly available: boolean;
    readonly onToggle: () => void;
    readonly open: boolean;
  };
}

const choices = (
  prefix: string,
  choice: PaletteChoice | undefined,
  title: (label: string) => string,
  keywords: readonly string[],
  shortcutId: PaletteAction["shortcutId"] = null
): readonly PaletteAction[] =>
  (choice?.options ?? [])
    .filter((option) => option.id !== choice?.current)
    .map((option) =>
      paletteAction(
        {
          disabled: option.disabled ?? false,
          id: `${prefix}:${option.id}`,
          keywords: [...keywords, option.label],
          section: "actions",
          shortcutId,
          title: title(option.label),
        },
        () => choice?.onSelect(option.id)
      )
    );

export const buildContextActions = (
  i18n: I18n,
  context: PaletteContext
): readonly PaletteAction[] => {
  const { chatContext, model, permissionMode, sandbox } = context;
  const sandboxAction =
    sandbox?.available === true
      ? [
          paletteAction(
            {
              id: "sandbox:toggle",
              keywords: [i18n._(msg`terminal`), i18n._(msg`files`)],
              section: "actions",
              shortcutId: "panel.sandbox",
              title: sandbox.open
                ? i18n._(msg`Hide the sandbox`)
                : i18n._(msg`Show the sandbox`),
            },
            sandbox.onToggle
          ),
        ]
      : [];
  return [
    ...choices(
      "model",
      model,
      (label) => i18n._(msg`Switch model to ${label}`),
      [i18n._(msg`model`)]
    ),
    ...(chatContext?.locked
      ? []
      : choices(
          "context",
          chatContext,
          (label) => i18n._(msg`Switch chat context to ${label}`),
          [i18n._(msg`context`), i18n._(msg`team`)]
        )),
    ...sandboxAction,
    ...choices(
      "permission",
      permissionMode,
      (label) => i18n._(msg`Set permission mode to ${label}`),
      [i18n._(msg`permissions`)]
    ),
  ];
};
