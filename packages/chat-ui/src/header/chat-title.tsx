"use client";

import { useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";

import { RenameInput } from "../sidebar/rename-input";

/** The chat's title in the header; click to rename (when there's a chat to rename). */
export function ChatTitle({
  onRename,
  title,
}: {
  readonly onRename?: (title: string) => void;
  readonly title: string | null;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const shown = title ?? t`New chat`;
  const start = useCallback(() => setEditing(true), []);
  const finish = useCallback(
    (next: string | null) => {
      setEditing(false);
      if (next !== null) {
        onRename?.(next);
      }
    },
    [onRename]
  );

  if (editing) {
    return (
      <RenameInput
        className="w-64 max-w-full"
        initial={title ?? ""}
        onDone={finish}
      />
    );
  }
  if (!onRename) {
    return <h1 className="truncate font-medium text-sm">{shown}</h1>;
  }
  return (
    <h1 className="flex min-w-0">
      <button
        aria-label={t`Rename chat: ${shown}`}
        className="max-w-full truncate rounded-md px-2 py-1 font-medium text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={start}
        title={t`Click to rename`}
        type="button"
      >
        {shown}
      </button>
    </h1>
  );
}
