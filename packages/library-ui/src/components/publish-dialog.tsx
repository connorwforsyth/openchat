"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  LibraryItem,
  LibraryItemDetail,
} from "@workspace/contract/schemas/library";
import type { Me } from "@workspace/contract/schemas/meta";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { useCallback, useId, useState } from "react";

import {
  errorCode,
  useMe,
  usePublishToLibrary,
  usePublishVersion,
} from "../hooks";
import { TextAreaField } from "./fields";

// Publish (D13, §8): freeze the draft as the next version, and optionally
// put a copy into a team or org library, which then owns it with the
// publisher as a maintainer. The library's publish gate (D21) runs on the
// server; it's informational unless the library says otherwise. Both steps
// are optimistic (D28).

type LibraryTarget = Principal & { readonly type: "team" | "org" };

const targetsFrom = (me: Me | undefined) => [
  ...(me?.teams ?? []).map(({ team }) => ({
    label: team.name,
    target: { id: team.id, type: "team" } as LibraryTarget,
  })),
  ...(me?.orgs ?? [])
    .filter((org) => !org.isPersonal)
    .map((org) => ({
      label: org.name,
      target: { id: org.id, type: "org" } as LibraryTarget,
    })),
];

const keyOf = (target: LibraryTarget) => `${target.type}:${target.id}`;

const isVersioned = (kind: LibraryItem["kind"]) =>
  kind === "agent" || kind === "prompt" || kind === "skill";

export interface PublishDialogProps {
  /** Unsaved edits would publish the stored draft, not what's on screen. */
  readonly dirty?: boolean;
  readonly item: LibraryItemDetail;
  readonly onOpenChange: (open: boolean) => void;
  /** A publish rolled back after the dialog closed. */
  readonly onProblem?: (message: string) => void;
  /**
   * Saves what's on screen; `false` when it couldn't. Given, unsaved edits
   * are saved and published in one step (170) instead of being left out.
   */
  readonly onSaveFirst?: () => Promise<boolean>;
  readonly open: boolean;
}

export function PublishDialog({
  dirty = false,
  item,
  onOpenChange,
  onProblem,
  onSaveFirst,
  open,
}: PublishDialogProps) {
  const { t } = useLingui();
  const me = useMe();
  const versioned = isVersioned(item.kind);
  const manage = item.myAccess === "owner" || item.myAccess === "maintainer";
  // Publishing into a library is for the item's own copy; a library copy is
  // versioned in place.
  const canCopy = manage && item.owner.type === "user";
  const targets = canCopy ? targetsFrom(me.data) : [];
  const [notes, setNotes] = useState("");
  const [toLibrary, setToLibrary] = useState(!versioned);
  const [target, setTarget] = useState<string | null>(null);
  const publishVersion = usePublishVersion(item.id);
  const publishCopy = usePublishToLibrary(item, me.data?.user.id ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const libraryId = useId();
  const nextVersion = (item.latestVersionNumber ?? 0) + 1;
  const chosen = targets.find((each) => keyOf(each.target) === target);
  const [savingFirst, setSavingFirst] = useState(false);
  const pending =
    savingFirst || publishVersion.isPending || publishCopy.isPending;
  const saveFirst = dirty && onSaveFirst !== undefined;

  const { mutate: copy } = publishCopy;
  const { mutate: freeze } = publishVersion;
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const copyToLibrary = useCallback(() => {
    if (chosen) {
      copy(
        { target: chosen.target },
        {
          onError: () =>
            onProblem?.(
              t`The library didn't accept it, so it was taken back out.`
            ),
        }
      );
    }
    onOpenChange(false);
  }, [chosen, copy, onOpenChange, onProblem, t]);

  const submit = useCallback(async () => {
    setProblem(null);
    if (saveFirst) {
      setSavingFirst(true);
      const saved = await onSaveFirst();
      setSavingFirst(false);
      if (!saved) {
        setProblem(
          t`Your changes couldn't be saved, so nothing was published.`
        );
        return;
      }
    }
    if (!versioned) {
      copyToLibrary();
      return;
    }
    freeze(
      { notes },
      {
        onError: (error) =>
          setProblem(
            errorCode(error) === "CONFLICT"
              ? t`Nothing has changed since the last version.`
              : t`Publishing failed, so nothing changed.`
          ),
        onSuccess: () => {
          setNotes("");
          if (toLibrary && chosen) {
            copyToLibrary();
          } else {
            onOpenChange(false);
          }
        },
      }
    );
  }, [
    chosen,
    copyToLibrary,
    freeze,
    notes,
    onOpenChange,
    onSaveFirst,
    saveFirst,
    t,
    toLibrary,
    versioned,
  ]);

  const toggleLibrary = useCallback((next: boolean) => setToLibrary(next), []);
  const chooseTarget = useCallback(
    (value: unknown) => setTarget(typeof value === "string" ? value : null),
    []
  );

  const { name } = item;
  const items = targets.map((each) => ({
    label: each.label,
    value: keyOf(each.target),
  }));

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Publish {name}</Trans>
          </DialogTitle>
          <DialogDescription>
            {versioned ? (
              <Trans>
                People using it get version {nextVersion} as soon as it's
                published. Your draft stays editable.
              </Trans>
            ) : (
              <Trans>
                Put a copy in a team or org library. The library owns it and you
                maintain it.
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {dirty ? <UnsavedNotice saveFirst={saveFirst} /> : null}
          {versioned ? (
            <TextAreaField
              description={t`Optional. Shown in the version history.`}
              label={t`What changed`}
              onValueChange={setNotes}
              value={notes}
            />
          ) : null}
          {targets.length > 0 ? (
            <>
              {versioned ? (
                <Field orientation="horizontal">
                  <Checkbox
                    checked={toLibrary}
                    id={`${libraryId}-toggle`}
                    onCheckedChange={toggleLibrary}
                  />
                  <FieldLabel
                    className="font-normal"
                    htmlFor={`${libraryId}-toggle`}
                  >
                    <Trans>Also publish to a team or org library</Trans>
                  </FieldLabel>
                </Field>
              ) : null}
              {toLibrary ? (
                <Field>
                  <FieldLabel htmlFor={libraryId}>
                    <Trans>Library</Trans>
                  </FieldLabel>
                  <Select
                    items={items}
                    onValueChange={chooseTarget}
                    value={target}
                  >
                    <SelectTrigger className="w-full" id={libraryId}>
                      <SelectValue placeholder={t`Choose a library`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {items.map((each) => (
                          <SelectItem key={each.value} value={each.value}>
                            {each.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    <Trans>
                      Members, and members of teams below it, can use it. The
                      library's publish policy is checked first.
                    </Trans>
                  </FieldDescription>
                </Field>
              ) : null}
            </>
          ) : null}
          {problem ? (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button onClick={close} variant="outline">
            <Trans>Cancel</Trans>
          </Button>
          <Button
            disabled={
              pending ||
              (toLibrary && !chosen && (!versioned || targets.length > 0))
            }
            onClick={submit}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            <PublishLabel
              nextVersion={nextVersion}
              saveFirst={saveFirst}
              versioned={versioned}
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnsavedNotice({ saveFirst }: { readonly saveFirst: boolean }) {
  return (
    <Alert>
      <AlertDescription>
        {saveFirst ? (
          <Trans>Your unsaved changes are saved first, then published.</Trans>
        ) : (
          <Trans>
            You have unsaved changes. Save the draft first to publish them.
          </Trans>
        )}
      </AlertDescription>
    </Alert>
  );
}

function PublishLabel({
  nextVersion,
  saveFirst,
  versioned,
}: {
  readonly nextVersion: number;
  readonly saveFirst: boolean;
  readonly versioned: boolean;
}) {
  if (!versioned) {
    return <Trans>Publish to library</Trans>;
  }
  return saveFirst ? (
    <Trans>Save and publish v{nextVersion}</Trans>
  ) : (
    <Trans>Publish v{nextVersion}</Trans>
  );
}
