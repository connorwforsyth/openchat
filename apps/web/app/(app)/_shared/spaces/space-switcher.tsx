"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { Space } from "@workspace/contract/schemas/spaces";
import {
  ChevronsUpDownIcon,
  LayersIcon,
  SettingsIcon,
  UserIcon,
} from "@workspace/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo } from "react";

import { routes } from "@/lib/routes";
import { useApi } from "../api";
import { useAppFrame } from "../app-frame";
import { contextForSpace, spaceForContext, withDepth } from "./active-space";

// The space switcher (191) at the top of the sidebar: which space new chats
// start in, whose shared content the Space page shows, and which space
// Space settings manage. Sub-spaces are indented under their parents.

const spaceKey = (space: Pick<Space, "id" | "type">) =>
  `${space.type}:${space.id}`;

/** The caller's spaces and the active one (the personal space until they pick). */
export const useActiveSpace = () => {
  const { query } = useApi();
  const { chat } = useAppFrame();
  const spaces = useQuery(query.spaces.list.queryOptions());
  const list = spaces.data ?? [];
  const active = spaceForContext(list, chat.draftContext) ?? list[0];
  const setActive = useCallback(
    (space: Space) => chat.setDraftContext(contextForSpace(space)),
    [chat]
  );
  return { active, setActive, spaces: list, status: spaces.status };
};

export const SpaceSwitcher = ({
  fallback,
}: {
  readonly fallback: ReactNode;
}) => {
  const { t } = useLingui();
  const router = useRouter();
  const { openSettings } = useAppFrame();
  const { active, setActive, spaces } = useActiveSpace();
  const outline = useMemo(() => withDepth(spaces), [spaces]);
  const openHome = useCallback(() => router.push(routes.space), [router]);
  const openSpaceSettings = useCallback(
    () => openSettings("space-members"),
    [openSettings]
  );
  const pick = useCallback(
    (value: unknown) => {
      const space = spaces.find((each) => spaceKey(each) === value);
      if (space) {
        setActive(space);
      }
    },
    [setActive, spaces]
  );
  if (!active) {
    return <>{fallback}</>;
  }
  const label = active.isPersonal ? t`Personal` : active.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t`Space: ${label}`}
        className="-ms-1 flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-start font-medium text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent"
        data-testid="space-switcher"
      >
        {active.isPersonal ? (
          <UserIcon aria-hidden className="size-4 shrink-0" />
        ) : (
          <LayersIcon aria-hidden className="size-4 shrink-0" />
        )}
        <span className="truncate">{label}</span>
        <ChevronsUpDownIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Spaces</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={pick} value={spaceKey(active)}>
            {outline.map(({ depth, space }) => (
              <DropdownMenuRadioItem
                key={spaceKey(space)}
                value={spaceKey(space)}
              >
                <span
                  className="flex min-w-0 flex-1 items-center gap-2"
                  style={{ paddingInlineStart: `${depth * 0.75}rem` }}
                >
                  <span className="truncate">
                    {space.isPersonal ? t`Personal` : space.name}
                  </span>
                  {space.myRole === "owner" && !space.isPersonal ? (
                    <span className="ms-auto text-muted-foreground text-xs">
                      <Trans>Owner</Trans>
                    </span>
                  ) : null}
                  {space.access === "root_member" ? (
                    <span className="ms-auto text-muted-foreground text-xs">
                      <Trans>Not a member</Trans>
                    </span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={openHome}>
            <LayersIcon aria-hidden />
            <Trans>Shared in {label}</Trans>
          </DropdownMenuItem>
          {active.isPersonal ? null : (
            <DropdownMenuItem onClick={openSpaceSettings}>
              <SettingsIcon aria-hidden />
              <Trans>Space settings</Trans>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
