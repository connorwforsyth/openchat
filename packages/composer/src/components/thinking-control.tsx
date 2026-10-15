"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDownIcon } from "@workspace/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { useCallback } from "react";

import {
  type LevelBlock,
  type LevelChoice,
  type ThinkingLevel,
  thinkingLevelSchema,
} from "../variants";

export interface ThinkingControlProps {
  readonly disabled?: boolean;
  readonly levels: readonly LevelChoice[];
  readonly onChange: (level: ThinkingLevel) => void;
  readonly value: ThinkingLevel;
}

export function useLevelLabel() {
  const { t } = useLingui();
  return (level: ThinkingLevel): string => {
    switch (level) {
      case "off":
        return t`Off`;
      case "on":
        return t`On`;
      case "minimal":
        return t`Minimal`;
      case "low":
        return t`Low`;
      case "medium":
        return t`Medium`;
      case "high":
        return t`High`;
      case "xhigh":
        return t`Extra high`;
      case "max":
        return t`Max`;
      default:
        return level satisfies never;
    }
  };
}

function BlockReason({ blocked }: { readonly blocked: LevelBlock }) {
  switch (blocked) {
    case "server":
      return <Trans>Needs server support</Trans>;
    case "fast":
      return <Trans>Not with Fast mode</Trans>;
    case "unavailable":
      return <Trans>No key in this context</Trans>;
    default:
      return blocked satisfies never;
  }
}

/**
 * How hard the chosen model thinks (105), after the model button: the
 * levels its provider takes, and any catalog entry that's a thinking mode of
 * it, shown as the level in use, a word with no icon (113). A level that
 * can't be sent yet is listed, disabled, with the reason.
 * Base UI's menu gives it arrow keys and Escape back to the button.
 */
export function ThinkingControl({
  disabled,
  levels,
  onChange,
  value,
}: ThinkingControlProps) {
  const { t } = useLingui();
  const levelLabel = useLevelLabel();
  const label = levelLabel(value);
  const choose = useCallback(
    (next: unknown) => {
      const parsed = thinkingLevelSchema.safeParse(next);
      if (parsed.success) {
        onChange(parsed.data);
      }
    },
    [onChange]
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <InputGroupButton
            aria-label={t`Thinking: ${label}`}
            className="rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
            size="sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <span>{label}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 opacity-60 max-sm:hidden"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Thinking</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={choose} value={value}>
            {levels.map((choice) => (
              <DropdownMenuRadioItem
                closeOnClick
                disabled={choice.blocked !== undefined}
                key={choice.level}
                value={choice.level}
              >
                <span className="flex min-w-0 flex-col">
                  <span>{levelLabel(choice.level)}</span>
                  {choice.blocked ? (
                    <span className="text-muted-foreground text-xs">
                      <BlockReason blocked={choice.blocked} />
                    </span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
