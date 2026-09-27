"use client";

import { Trans } from "@lingui/react/macro";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";

import { shortcuts } from "./registry";
import { ShortcutHint } from "./shortcut-hint";
import { useShortcutLabels } from "./use-shortcut-labels";

/** The `?` sheet: every registered shortcut and what it does. */
export function ShortcutHelp({
  onOpenChange,
  open,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const labels = useShortcutLabels();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
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
        <dl className="flex flex-col gap-1.5 text-sm">
          {shortcuts.map((shortcut) => (
            <div className="flex items-center gap-3" key={shortcut.id}>
              <dt className="min-w-0 flex-1 text-muted-foreground">
                {labels[shortcut.id]}
              </dt>
              <dd>
                <ShortcutHint id={shortcut.id} />
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
