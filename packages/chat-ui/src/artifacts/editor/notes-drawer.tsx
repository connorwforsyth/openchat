"use client";

// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/components/notes-drawer.tsx. MIT, Copyright (c)
// 2026 Yiwei Ho; see NOTICE.open-slide.

import { useLingui } from "@lingui/react/macro";
import { FileTextIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useShellPanels } from "./editor-shell";

// Notes on the piece being edited (a slide's speaker notes), under the
// canvas, shared by every kind's editor: a text field kept as typed and
// saved when the person leaves it or presses ⌘Enter; Escape leaves the
// field. The editor shell shows and hides it as one of its panels.

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
  const shell = useShellPanels();
  const section = useRef<HTMLElement>(null);
  // The button goes with the notes; focus moves to the toolbar's toggle,
  // which brings them back.
  const hide = useCallback(() => {
    const toggle = section.current
      ?.closest("[data-artifact-editor]")
      ?.querySelector<HTMLElement>('[data-panel-toggle="notes"]');
    shell?.toggle("notes");
    toggle?.focus();
  }, [shell]);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

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
    <section
      aria-label={label}
      className="shrink-0 border-t bg-background"
      ref={section}
    >
      <div className="flex h-9 items-center gap-2 ps-3 pe-1 text-xs">
        <FileTextIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <label className="font-medium" htmlFor={id}>
          {label}
        </label>
        {meta ? (
          <span className="text-muted-foreground tabular-nums">{meta}</span>
        ) : null}
        <span className="flex-1" />
        {shell ? (
          <Button
            aria-label={t`Hide notes`}
            onClick={hide}
            size="icon-xs"
            title={t`Hide notes`}
            variant="ghost"
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="px-3 pb-3">
        <Textarea
          className="max-h-40 min-h-20 resize-none text-sm"
          id={id}
          onBlur={commit}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={readOnly ? t`None` : placeholder}
          readOnly={readOnly}
          value={draft}
        />
      </div>
    </section>
  );
}
