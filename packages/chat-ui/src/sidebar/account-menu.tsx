"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  Building2Icon,
  ChevronsUpDownIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
} from "@workspace/icons";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
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
import { cn } from "@workspace/ui/lib/utils";
import { useCallback } from "react";
import { z } from "zod";

import { initialsOf } from "../model/people";

export const themeSchema = z.enum(["light", "dark", "system"]);
export type Theme = z.infer<typeof themeSchema>;

export interface AccountMenuProps {
  /** Just the avatar, for the collapsed rail (179). */
  readonly compact?: boolean;
  /** "New organisation": anyone can create an org (D17). */
  readonly onNewOrg?: () => void;
  /** Shown only to instance or org admins (the admin area is ticket 024). */
  readonly onOpenAdmin?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onSignOut: () => void;
  readonly onThemeChange: (theme: Theme) => void;
  readonly theme: Theme;
  readonly user: {
    readonly email: string;
    readonly image: string | null;
    readonly name: string;
  };
}

/** The sidebar footer: who you are, theme, settings, admin and sign out. */
export function AccountMenu({
  onNewOrg,
  onOpenAdmin,
  onOpenSettings,
  onSignOut,
  onThemeChange,
  theme,
  user,
  compact = false,
}: AccountMenuProps) {
  const { t } = useLingui();
  const changeTheme = useCallback(
    (value: unknown) => {
      const parsed = themeSchema.safeParse(value);
      if (parsed.success) {
        onThemeChange(parsed.data);
      }
    },
    [onThemeChange]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t`Account: ${user.name}`}
        className={cn(
          "flex h-11 min-w-0 items-center gap-2 rounded-md text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent",
          compact ? "size-9 justify-center rounded-xl" : "w-full px-2"
        )}
      >
        <Avatar size="sm">
          {user.image ? <AvatarImage alt="" src={user.image} /> : null}
          <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
        </Avatar>
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1 truncate">{user.name}</span>
            <ChevronsUpDownIcon aria-hidden className="size-4 opacity-60" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-foreground">{user.name}</span>
            <span className="truncate font-normal">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Theme</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={changeTheme} value={theme}>
            <DropdownMenuRadioItem closeOnClick={false} value="light">
              <SunIcon aria-hidden />
              <Trans>Light</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick={false} value="dark">
              <MoonIcon aria-hidden />
              <Trans>Dark</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick={false} value="system">
              <MonitorIcon aria-hidden />
              <Trans>System</Trans>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {onOpenSettings ? (
            <DropdownMenuItem onClick={onOpenSettings}>
              <SettingsIcon aria-hidden />
              <Trans>Settings</Trans>
            </DropdownMenuItem>
          ) : null}
          {onOpenAdmin ? (
            <DropdownMenuItem onClick={onOpenAdmin}>
              <ShieldIcon aria-hidden />
              <Trans>Admin</Trans>
            </DropdownMenuItem>
          ) : null}
          {onNewOrg ? (
            <DropdownMenuItem onClick={onNewOrg}>
              <Building2Icon aria-hidden />
              <Trans>New organisation</Trans>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onSignOut}>
            <LogOutIcon aria-hidden />
            <Trans>Sign out</Trans>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
