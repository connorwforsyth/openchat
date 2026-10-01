"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { contextKey } from "@workspace/composer/options";
import type { ContextOption } from "@workspace/composer/schemas";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import {
  Building2Icon,
  ChevronDownIcon,
  LockIcon,
  UserIcon,
  UsersIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback } from "react";

export interface ContextControlProps {
  /** Fixed once the chat has its first message (D17). */
  readonly locked: boolean;
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
 * Whether there's a context worth showing: the person belongs to a team or
 * an org, or the chat is in one. Someone with only Personal never sees it.
 */
export const showsContext = (
  options: readonly ContextOption[],
  value: ChatContext
): boolean => options.length > 1 || value.type !== "personal";

// Quiet: muted, small, no border, as tall as the title's button.
const QUIET =
  "h-7 min-w-0 max-w-40 shrink-0 gap-1.5 px-2 font-normal text-muted-foreground text-sm [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * Whose keys pay and where usage rolls up (D17): Personal, a team or an org,
 * beside the chat's title (113). Chosen from a menu until the first message;
 * after that it's text. Render it only where `showsContext` says so.
 */
export function ContextControl({
  locked,
  onChange,
  options,
  value,
}: ContextControlProps) {
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
    return (
      <span
        className={cn("flex items-center", QUIET)}
        data-locked={locked ? "" : undefined}
        data-slot="chat-context"
      >
        <span className="sr-only">
          <Trans>Chat context:</Trans>
        </span>
        <ContextIconFor context={value} />
        <span className="min-w-0 truncate">{label}</span>
        {locked ? <LockIcon aria-hidden className="opacity-60" /> : null}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Chat context: ${label}`}
            className={cn(
              QUIET,
              "hover:text-foreground aria-expanded:text-foreground"
            )}
            data-slot="chat-context"
            size="sm"
            variant="ghost"
          />
        }
      >
        <ContextIconFor context={value} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
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
          <p className="px-1.5 pt-1 pb-1.5 text-muted-foreground text-xs">
            <Trans>
              Whose keys and budget this chat uses. It can't change after the
              first message.
            </Trans>
          </p>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
