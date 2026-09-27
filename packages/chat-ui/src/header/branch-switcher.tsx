"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { SiblingInfo } from "@workspace/contract/schemas/messages";
import { ChevronLeftIcon, ChevronRightIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback } from "react";

import { hasBranches, stepSibling } from "../model/branch";

export interface BranchSwitcherProps {
  readonly className?: string;
  readonly info: SiblingInfo | null | undefined;
  /** Called with the sibling message to switch to. */
  readonly onSelect: (messageId: MessageId) => void;
  readonly size?: "xs" | "sm";
}

/**
 * ‹ 2/3 ›: moves between a message's siblings (edits and regenerations,
 * D25). Renders nothing when there's only one. The header's and each
 * message's switchers read the same branch path, so they stay in step.
 */
export function BranchSwitcher({
  className,
  info,
  onSelect,
  size = "xs",
}: BranchSwitcherProps) {
  const { t } = useLingui();
  const previous = info ? stepSibling(info, -1) : null;
  const next = info ? stepSibling(info, 1) : null;
  const goPrevious = useCallback(() => {
    if (previous) {
      onSelect(previous);
    }
  }, [onSelect, previous]);
  const goNext = useCallback(() => {
    if (next) {
      onSelect(next);
    }
  }, [next, onSelect]);

  if (!(info && hasBranches(info))) {
    return null;
  }
  const position = info.index + 1;
  const total = info.siblingIds.length;
  const buttonSize = size === "xs" ? "icon-xs" : "icon-sm";

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields, so not a fieldset.
    <div
      aria-label={t`Branches`}
      className={cn("flex items-center", className)}
      role="group"
    >
      <Button
        aria-label={t`Previous branch`}
        disabled={previous === null}
        onClick={goPrevious}
        size={buttonSize}
        variant="ghost"
      >
        <ChevronLeftIcon aria-hidden />
      </Button>
      <span
        aria-live="polite"
        className="min-w-8 text-center text-muted-foreground text-xs tabular-nums"
      >
        <Trans>
          {position}/{total}
        </Trans>
      </span>
      <Button
        aria-label={t`Next branch`}
        disabled={next === null}
        onClick={goNext}
        size={buttonSize}
        variant="ghost"
      >
        <ChevronRightIcon aria-hidden />
      </Button>
    </div>
  );
}
