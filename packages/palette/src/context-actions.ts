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
  /** The chat's artifacts: opens the header's Artifacts list (night 2). */
  readonly artifacts?: { readonly onOpen: () => void };
  /** Chat context (Personal / team / org). Locked after the first message (D17). */
  readonly chatContext?: PaletteChoice & { readonly locked: boolean };
  readonly model?: PaletteChoice;
  /** Cowork permission modes (desktop). */
  readonly permissionMode?: PaletteChoice;
  /** The chat's Workspace panel: its files, preview and artifacts (060). */
  readonly workspace?: {
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
  const { artifacts, chatContext, model, permissionMode, workspace } = context;
  const artifactsAction = artifacts
    ? [
        paletteAction(
          {
            id: "artifacts:open",
            keywords: [
              i18n._(msg`artifacts`),
              i18n._(msg`slides`),
              i18n._(msg`documents`),
              i18n._(msg`preview`),
            ],
            section: "actions",
            shortcutId: "panel.artifacts",
            title: i18n._(msg`Show this chat's artifacts`),
          },
          artifacts.onOpen
        ),
      ]
    : [];
  const workspaceAction =
    workspace?.available === true
      ? [
          paletteAction(
            {
              id: "workspace:toggle",
              keywords: [i18n._(msg`files`), i18n._(msg`preview`)],
              section: "actions",
              shortcutId: "panel.sandbox",
              title: workspace.open
                ? i18n._(msg`Hide the workspace`)
                : i18n._(msg`Show the workspace`),
            },
            workspace.onToggle
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
    ...artifactsAction,
    ...workspaceAction,
    ...choices(
      "permission",
      permissionMode,
      (label) => i18n._(msg`Set permission mode to ${label}`),
      [i18n._(msg`permissions`)]
    ),
  ];
};
