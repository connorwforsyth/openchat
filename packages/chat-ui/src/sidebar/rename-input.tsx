"use client";

import { useLingui } from "@lingui/react/macro";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Inline title editing: Enter or blur saves, Escape cancels. `onDone` gets
 * the trimmed title, or `null` when cancelled or left empty.
 *
 * A blur the user didn't cause doesn't end it (071): a menu handing focus
 * back as it closes (to its trigger, or to another row's) used to blur the
 * fresh input, which saved "no change" and closed it before anyone could
 * type. Until the user clicks somewhere or presses a key, focus that moves
 * away comes back here.
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
  const input = useRef<HTMLInputElement>(null);
  // `as boolean`: Biome otherwise reads the ref as always `false`.
  const userActed = useRef(false as boolean);

  useEffect(() => {
    const acted = () => {
      userActed.current = true;
    };
    // Capture: a click elsewhere counts before the blur it causes.
    document.addEventListener("pointerdown", acted, true);
    return () => document.removeEventListener("pointerdown", acted, true);
  }, []);

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
      userActed.current = true;
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
  const onBlur = useCallback(() => {
    if (!document.hasFocus()) {
      // The window lost focus; it comes back here when the window does.
      return;
    }
    if (!userActed.current) {
      // Moved by code, not the user: after that settles, take focus back.
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    finish(value);
  }, [finish, value]);
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
      ref={input}
      value={value}
    />
  );
}
