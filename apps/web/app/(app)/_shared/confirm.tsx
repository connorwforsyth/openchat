"use client";

import { Trans } from "@lingui/react/macro";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { type ReactNode, useCallback, useState } from "react";

// A button that asks before doing something that can't be undone (remove a
// key, a member, a team). The confirm button names the action again.

export const ConfirmButton = ({
  children,
  confirmLabel,
  description,
  disabled,
  label,
  onConfirm,
  title,
}: {
  /** The trigger's content. */
  readonly children: ReactNode;
  readonly confirmLabel: ReactNode;
  readonly description: ReactNode;
  readonly disabled?: boolean;
  /** The trigger's accessible name, when its content is an icon or ambiguous. */
  readonly label?: string;
  readonly onConfirm: () => void;
  readonly title: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const confirm = useCallback(() => {
    setOpen(false);
    onConfirm();
  }, [onConfirm]);
  return (
    <>
      <Button
        aria-label={label}
        disabled={disabled}
        onClick={show}
        size="sm"
        variant="ghost"
      >
        {children}
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirm} variant="destructive">
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
