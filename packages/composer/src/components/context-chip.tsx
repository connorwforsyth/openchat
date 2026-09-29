"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import {
  Building2Icon,
  ChevronDownIcon,
  LockIcon,
  UserIcon,
  UsersIcon,
} from "@workspace/icons";
import { PromptInputButton } from "@workspace/ui/components/ai-elements/prompt-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useCallback } from "react";

import { contextKey } from "../options";
import type { ContextOption } from "../schemas";

export interface ContextChipProps {
  readonly disabled?: boolean;
  /** Fixed once the chat has its first message (D17). */
  readonly locked?: boolean;
  readonly onChange?: (context: ChatContext) => void;
  readonly options: readonly ContextOption[];
  readonly value: ChatContext;
}

function ContextIconFor({ context }: { readonly context: ChatContext }) {
  switch (context.type) {
    case "personal":
      return <UserIcon aria-hidden />;
    case "team":
      return <UsersIcon aria-hidden />;
    case "org":
      return <Building2Icon aria-hidden />;
    default:
      return context satisfies never;
  }
}

function useContextLabel() {
  const { t } = useLingui();
  return useCallback(
    (context: ChatContext, name: string | undefined): string => {
      switch (context.type) {
        case "personal":
          return t`Personal`;
        case "team":
          return name ?? t`Team`;
        case "org":
          return name ?? t`Organization`;
        default:
          return context satisfies never;
      }
    },
    [t]
  );
}

/**
 * A context as a plain line (icon, name, lock), for where a locked context is
 * shown rather than chosen: the chat header's Share menu (D14).
 */
export function ContextSummary({
  options,
  value,
}: Pick<ContextChipProps, "options" | "value">) {
  const labelFor = useContextLabel();
  const key = contextKey(value);
  const label = labelFor(
    value,
    options.find((option) => contextKey(option.context) === key)?.name
  );
  return (
    <span className="flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
      <ContextIconFor context={value} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <LockIcon aria-hidden className="text-muted-foreground" />
    </span>
  );
}

/** Whose keys pay and where usage rolls up: Personal, a team or an org. */
export function ContextChip({
  disabled,
  locked,
  onChange,
  options,
  value,
}: ContextChipProps) {
  const { t } = useLingui();
  const labelFor = useContextLabel();
  const key = contextKey(value);
  const label = labelFor(
    value,
    options.find((option) => contextKey(option.context) === key)?.name
  );

  const handleValueChange = useCallback(
    (next: unknown) => {
      const option = options.find(
        (candidate) => contextKey(candidate.context) === next
      );
      if (option) {
        onChange?.(option.context);
      }
    },
    [onChange, options]
  );

  if (locked || !onChange) {
    // Still focusable (aria-disabled, not disabled) so keyboard users can
    // reach the tooltip that says why it can't change.
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <PromptInputButton
              aria-disabled
              aria-label={t`Chat context: ${label}, locked`}
              className="rounded-full text-muted-foreground"
              size="sm"
            />
          }
        >
          <ContextIconFor context={value} />
          <span className="max-w-32 truncate">{label}</span>
          <LockIcon aria-hidden className="size-3" />
        </TooltipTrigger>
        <TooltipContent>
          <Trans>The context can't change after the first message.</Trans>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <PromptInputButton
            aria-label={t`Chat context: ${label}`}
            className="rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
            size="sm"
          />
        }
      >
        <ContextIconFor context={value} />
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Chat context</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={handleValueChange} value={key}>
            {options.map((option) => (
              <DropdownMenuRadioItem
                closeOnClick
                key={contextKey(option.context)}
                value={contextKey(option.context)}
              >
                <ContextIconFor context={option.context} />
                <span className="truncate">
                  {labelFor(option.context, option.name)}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
