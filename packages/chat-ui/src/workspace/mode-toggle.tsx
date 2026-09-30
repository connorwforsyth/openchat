"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { CodeIcon, EyeIcon } from "@workspace/icons";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback } from "react";

import type { FileMode } from "./model/browser";

// A rendered file's Preview | Code switch (066), restyled for 070: two quiet
// segments in the view's header row, no outline. The words show when the row
// has room; otherwise the icons carry them (and their labels).

export interface ModeToggleProps {
  /**
   * `auto`: the words show when the view is wide (a container query);
   * `hidden`: icons only, for a row that measured itself short.
   */
  readonly labels?: "auto" | "hidden" | "shown";
  readonly mode: FileMode;
  readonly onModeChange: (mode: FileMode) => void;
}

const labelClass = {
  auto: "@md/view:inline hidden",
  hidden: "hidden",
  shown: "inline",
} as const;

export function ModeToggle({
  labels = "auto",
  mode,
  onModeChange,
}: ModeToggleProps) {
  const { t } = useLingui();
  const change = useCallback(
    (value: unknown[]) => {
      // A segmented control: pressing the shown mode keeps it.
      const [next] = value;
      if (next === "rendered" || next === "code") {
        onModeChange(next);
      }
    },
    [onModeChange]
  );
  const preview = t`Preview`;
  const code = t`Code`;
  return (
    <ToggleGroup
      aria-label={t`Show as`}
      className="shrink-0"
      onValueChange={change}
      size="sm"
      spacing={1}
      value={[mode]}
    >
      <ToggleGroupItem
        aria-label={preview}
        className="px-1.5 text-xs"
        title={preview}
        value="rendered"
      >
        <EyeIcon aria-hidden />
        <span className={cn(labelClass[labels])}>
          <Trans>Preview</Trans>
        </span>
      </ToggleGroupItem>
      <ToggleGroupItem
        aria-label={code}
        className="px-1.5 text-xs"
        title={code}
        value="code"
      >
        <CodeIcon aria-hidden />
        <span className={cn(labelClass[labels])}>
          <Trans>Code</Trans>
        </span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
