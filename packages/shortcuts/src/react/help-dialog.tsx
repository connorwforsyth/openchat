"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import type { ReactNode } from "react";

import {
  type ShortcutDefinition,
  type ShortcutGroup,
  shortcutGroupSchema,
  shortcutRegistry,
} from "../registry";
import { useShortcuts } from "./context";
import { ComboKbd } from "./shortcut-kbd";
import { useShortcut } from "./use-shortcut";

// The `?` dialog (D10): every shortcut, grouped, with the keys that are live
// now (recorded overrides included). It binds `help` itself, so mounting it
// once in the shell is all a surface needs.

export const groupShortcuts = (
  registry: readonly ShortcutDefinition[] = shortcutRegistry
): readonly (readonly [ShortcutGroup, readonly ShortcutDefinition[]])[] =>
  shortcutGroupSchema.options
    .map(
      (group) =>
        [group, registry.filter((each) => each.group === group)] as const
    )
    .filter(([, definitions]) => definitions.length > 0);

export const GroupHeading = ({ group }: { readonly group: ShortcutGroup }) => {
  switch (group) {
    case "general":
      return <Trans>General</Trans>;
    case "navigation":
      return <Trans>Navigation</Trans>;
    case "conversation":
      return <Trans>Conversation</Trans>;
    case "panels":
      return <Trans>Panels</Trans>;
    default:
      return group satisfies never;
  }
};

export interface ShortcutsHelpDialogProps {
  /** Under the list, e.g. a link to the settings page where keys are recorded. */
  readonly footer?: ReactNode;
}

export const ShortcutsHelpDialog = ({ footer }: ShortcutsHelpDialogProps) => {
  const { i18n } = useLingui();
  const { bindings, helpOpen, setHelpOpen } = useShortcuts();
  useShortcut("help", () => setHelpOpen(!helpOpen));

  return (
    <Dialog onOpenChange={setHelpOpen} open={helpOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Keyboard shortcuts</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Single keys work when you're not typing in a text field.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-4">
          {groupShortcuts().map(([group, definitions]) => (
            <section className="flex flex-col gap-1" key={group}>
              <h3 className="font-medium text-muted-foreground text-xs">
                <GroupHeading group={group} />
              </h3>
              <dl className="flex flex-col">
                {definitions.map((definition) => {
                  const combos = bindings.get(definition.id) ?? [];
                  return (
                    <div
                      className="flex min-h-8 items-center justify-between gap-4"
                      key={definition.id}
                    >
                      <dt>{i18n._(definition.description)}</dt>
                      <dd className="flex items-center gap-2">
                        {combos.length > 0 ? (
                          combos.map((combo) => (
                            <ComboKbd combo={combo} key={combo} />
                          ))
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            <Trans>Off</Trans>
                          </span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
};
