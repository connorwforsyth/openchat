"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useId, useState } from "react";

// The editors' frame (D13, 192): a full-screen view with a bar on top, the
// configuration in a readable column on one side and a live pane (test chat,
// preview, files) on the other, like ChatGPT's GPT builder. Narrow screens
// get one pane at a time and a Configure / Preview switch, so nothing is
// squeezed beside the form.

export type EditorPane = "configure" | "preview";

export function EditorFrame({
  bar,
  children,
  preview,
  previewLabel,
}: {
  readonly bar: ReactNode;
  readonly children: ReactNode;
  readonly preview: ReactNode;
  /** Names the live pane, for the narrow-screen switch and screen readers. */
  readonly previewLabel: string;
}) {
  const [pane, setPane] = useState<EditorPane>("configure");
  return (
    <div className="flex h-svh min-h-0 flex-col bg-background">
      {bar}
      <PaneSwitch onChange={setPane} pane={pane} previewLabel={previewLabel} />
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto",
            pane === "configure" ? "block" : "hidden lg:block"
          )}
          data-slot="editor-configure"
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-8 md:px-8">
            {children}
          </div>
        </div>
        <aside
          aria-label={previewLabel}
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col border-border bg-muted/30 p-4 md:p-6 lg:flex lg:border-s",
            pane === "preview" ? "flex" : "hidden"
          )}
          data-slot="editor-preview"
        >
          {preview}
        </aside>
      </div>
    </div>
  );
}

function PaneSwitch({
  onChange,
  pane,
  previewLabel,
}: {
  readonly onChange: (pane: EditorPane) => void;
  readonly pane: EditorPane;
  readonly previewLabel: string;
}) {
  const { t } = useLingui();
  const choose = useCallback(
    (values: string[]) => {
      const [next] = values;
      if (next === "configure" || next === "preview") {
        onChange(next);
      }
    },
    [onChange]
  );
  return (
    <div className="flex shrink-0 justify-center border-border border-b p-2 lg:hidden">
      <ToggleGroup
        aria-label={t`Editor view`}
        onValueChange={choose}
        size="sm"
        value={[pane]}
        variant="outline"
      >
        <ToggleGroupItem value="configure">
          <Trans>Configure</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="preview">{previewLabel}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/** A titled part of an editor's form: identity, instructions, knowledge… */
export function EditorSection({
  action,
  children,
  description,
  title,
}: {
  /** Beside the title, like a mode switch. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly title: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-medium text-base" id={id}>
            {title}
          </h2>
          {description ? (
            <p className="text-pretty text-muted-foreground text-sm">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
