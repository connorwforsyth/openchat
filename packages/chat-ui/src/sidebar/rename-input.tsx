"use client";

import { useLingui } from "@lingui/react/macro";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from "react";

/**
 * Inline title editing: Enter or blur saves, Escape cancels. `onDone` gets
 * the trimmed title, or `null` when cancelled or left empty.
 */
export function RenameInput({
  className,
  initial,
  onDone,
}: {
  readonly className?: string;
  readonly initial: string;
  readonly onDone: (title: string | null) => void;
}) {
  const { t } = useLingui();
  const [value, setValue] = useState(initial);

  const finish = useCallback(
    (next: string | null) => {
      const trimmed = next?.trim() ?? "";
      onDone(trimmed === "" || trimmed === initial ? null : trimmed);
    },
    [initial, onDone]
  );
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
    []
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(value);
      } else if (event.key === "Escape") {
        // Escape belongs to the rename, not to whatever contains it.
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    },
    [finish, value]
  );
  const onBlur = useCallback(() => finish(value), [finish, value]);
  const selectAll = useCallback(
    (event: FocusEvent<HTMLInputElement>) => event.target.select(),
    []
  );

  return (
    <Input
      aria-label={t`Chat title`}
      autoFocus
      className={cn("h-7 px-2 text-sm", className)}
      maxLength={200}
      onBlur={onBlur}
      onChange={onChange}
      onFocus={selectAll}
      onKeyDown={onKeyDown}
      value={value}
    />
  );
}
