"use client";

// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/components/notes-drawer.tsx. MIT, Copyright (c)
// 2026 Yiwei Ho; see NOTICE.open-slide.

import { useLingui } from "@lingui/react/macro";
import { ChevronDownIcon, ChevronUpIcon, FileTextIcon } from "@workspace/icons";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

// Notes on the piece being edited (a slide's speaker notes), under the
// canvas, shared by every kind's editor. Folded away, it's one row; open,
// it's a text field kept as typed and saved when the person leaves it or
// presses ⌘Enter; Escape leaves the field. It opens and closes at once
// (D28: toggled, not animated), and remembers which.

const OPEN_KEY = "artifact-editor:notes-open";

const readOpen = (): boolean => {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

export function NotesDrawer({
  label,
  meta,
  onCommit,
  placeholder,
  readOnly,
  value,
}: {
  /** What the notes are ("Speaker notes"). */
  readonly label: string;
  /** Beside the label: which piece they belong to ("Slide 2 of 5"). */
  readonly meta?: ReactNode;
  readonly onCommit: (value: string) => void;
  readonly placeholder: string;
  readonly readOnly: boolean;
  readonly value: string;
}) {
  const { t } = useLingui();
  const id = useId();
  const [open, setOpen] = useState(readOpen);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const toggle = useCallback(() => {
    setOpen((was) => {
      try {
        window.localStorage.setItem(OPEN_KEY, was ? "0" : "1");
      } catch {
        // Storage can be off; the drawer still opens.
      }
      return !was;
    });
  }, []);
  const commit = useCallback(() => {
    if (!readOnly && draft !== value) {
      onCommit(draft);
    }
  }, [draft, onCommit, readOnly, value]);
  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
    []
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.blur();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    },
    [commit]
  );

  return (
    <section aria-label={label} className="shrink-0 border-t bg-background">
      <button
        aria-controls={id}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 px-3 text-start text-xs outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={toggle}
        type="button"
      >
        <FileTextIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        {meta ? (
          <span className="text-muted-foreground tabular-nums">{meta}</span>
        ) : null}
        <span className="flex-1" />
        {open ? (
          <ChevronDownIcon aria-hidden className="size-3.5" />
        ) : (
          <ChevronUpIcon aria-hidden className="size-3.5" />
        )}
      </button>
      {open ? (
        <div className="px-3 pb-3" id={id}>
          <Textarea
            aria-label={label}
            className="max-h-40 min-h-20 resize-none text-sm"
            onBlur={commit}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={readOnly ? t`None` : placeholder}
            readOnly={readOnly}
            value={draft}
          />
        </div>
      ) : null}
    </section>
  );
}
