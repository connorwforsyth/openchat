"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CodeView } from "@workspace/code-ui/code-view";
import type { LibraryVersionId } from "@workspace/contract/schemas/common";
import type {
  LibraryItemDetail,
  LibraryVersion,
} from "@workspace/contract/schemas/library";
import { formatDate } from "@workspace/i18n/format";
import { LockIcon, RotateCcwIcon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useCallback, useState } from "react";

import { useRestoreVersion, useVersions } from "../hooks";

// Version history (D13): published versions newest first, then the draft.
// Editors can restore a version into the draft; anyone who can view it can
// pin one, so their chats keep running that version until they unpin.

export interface VersionHistoryProps {
  readonly item: Pick<LibraryItemDetail, "id" | "myAccess" | "name">;
  readonly onOpenChange: (open: boolean) => void;
  /** Pin a version for yourself, or `null` to follow the latest again. */
  readonly onPin?: (versionId: LibraryVersionId | null) => void;
  readonly open: boolean;
  readonly pinnedVersionId?: LibraryVersionId | null;
}

export function VersionHistory({
  item,
  onOpenChange,
  onPin,
  open,
  pinnedVersionId = null,
}: VersionHistoryProps) {
  const { name } = item;
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>History of {name}</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Everyone gets the latest published version unless they pin one.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <VersionList
            canEdit={
              item.myAccess === "owner" ||
              item.myAccess === "maintainer" ||
              item.myAccess === "edit"
            }
            id={item.id}
            onPin={onPin}
            onRestored={close}
            pinnedVersionId={pinnedVersionId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function VersionList({
  canEdit,
  id,
  onPin,
  onRestored,
  pinnedVersionId,
}: {
  readonly canEdit: boolean;
  readonly id: LibraryItemDetail["id"];
  readonly onPin?: (versionId: LibraryVersionId | null) => void;
  readonly onRestored: () => void;
  readonly pinnedVersionId: LibraryVersionId | null;
}) {
  const versions = useVersions(id);
  const restore = useRestoreVersion(id);
  const { mutate: restoreVersion } = restore;
  const [open, setOpen] = useState<string | null>(null);
  const onRestore = useCallback(
    (versionId: LibraryVersionId) =>
      restoreVersion(versionId, { onSuccess: onRestored }),
    [onRestored, restoreVersion]
  );
  const onToggle = useCallback(
    (versionId: string) =>
      setOpen((current) => (current === versionId ? null : versionId)),
    []
  );

  if (versions.isPending) {
    return <Skeleton className="h-24" />;
  }
  const list = versions.data ?? [];
  if (list.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans>No versions yet.</Trans>
      </p>
    );
  }
  return (
    <ol className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
      {list.map((version) => (
        <VersionRow
          canEdit={canEdit}
          expanded={open === version.id}
          key={version.id}
          onPin={onPin}
          onRestore={onRestore}
          onToggle={onToggle}
          pinned={pinnedVersionId === version.id}
          restoring={restore.isPending}
          version={version}
        />
      ))}
    </ol>
  );
}

function VersionRow({
  canEdit,
  expanded,
  onPin,
  onRestore,
  onToggle,
  pinned,
  restoring,
  version,
}: {
  readonly canEdit: boolean;
  readonly expanded: boolean;
  readonly onPin?: (versionId: LibraryVersionId | null) => void;
  readonly onRestore: (versionId: LibraryVersionId) => void;
  readonly onToggle: (versionId: string) => void;
  readonly pinned: boolean;
  readonly restoring: boolean;
  readonly version: LibraryVersion;
}) {
  const { i18n } = useLingui();
  const { id } = version;
  const toggle = useCallback(() => onToggle(id), [id, onToggle]);
  const restoreThis = useCallback(() => onRestore(id), [id, onRestore]);
  const pin = useCallback(
    () => onPin?.(pinned ? null : id),
    [id, onPin, pinned]
  );
  const { number } = version;
  const published = version.publishedAt
    ? formatDate(version.publishedAt, i18n.locale, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {number === null ? (
          <Badge variant="outline">
            <Trans>Draft</Trans>
          </Badge>
        ) : (
          <Badge variant="secondary">
            <Trans>v{number}</Trans>
          </Badge>
        )}
        {pinned ? (
          <Badge variant="ghost">
            <LockIcon data-icon="inline-start" />
            <Trans>Pinned</Trans>
          </Badge>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm">
          {version.notes ?? ""}
        </span>
        {published ? (
          <time
            className="text-muted-foreground text-xs"
            dateTime={version.publishedAt ?? undefined}
          >
            {published}
          </time>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          aria-expanded={expanded}
          onClick={toggle}
          size="sm"
          variant="ghost"
        >
          {expanded ? <Trans>Hide</Trans> : <Trans>Show</Trans>}
        </Button>
        {canEdit && version.status === "published" ? (
          <Button
            disabled={restoring}
            onClick={restoreThis}
            size="sm"
            variant="ghost"
          >
            <RotateCcwIcon data-icon="inline-start" />
            <Trans>Restore to draft</Trans>
          </Button>
        ) : null}
        {onPin && version.status === "published" ? (
          <Button onClick={pin} size="sm" variant="ghost">
            {pinned ? <Trans>Unpin</Trans> : <Trans>Pin this version</Trans>}
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <CodeView
          contents={JSON.stringify(version.definition, null, 2)}
          path={`v${number ?? "draft"}.json`}
          wrap
        />
      ) : null}
    </li>
  );
}
