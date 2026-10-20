"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useNarrowScreen } from "@workspace/chat-ui/shell/use-narrow-screen";
import {
  BrainIcon,
  ChevronLeftIcon,
  KeyboardIcon,
  KeyRoundIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
} from "@workspace/icons";
import { ShortcutsEditor } from "@workspace/shortcuts/react/shortcuts-editor";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { type MouseEvent, type ReactNode, useCallback, useState } from "react";

import { AppearanceSettings } from "./appearance-settings";
import { MemorySettings } from "./memory-settings";
import { PersonalKeys } from "./personal-keys";
import { ProfileSettings } from "./profile-settings";
import {
  DEFAULT_SETTINGS_SECTION,
  type SettingsRoute,
  type SettingsSection,
  settingsSectionSchema,
} from "./settings-route";

// Settings as a dialog over the current page (185), like ChatGPT's: the
// sections on the start side, the section on the other, scrolling on its
// own. Below `md` it fills the screen and shows one at a time: the list,
// then a section with a way back to the list. It appears at once and fades
// out (the Dialog's motion), so ⌘, isn't slowed down.

interface SectionInfo {
  readonly content: ReactNode;
  readonly description?: ReactNode;
  readonly icon: ReactNode;
  readonly label: ReactNode;
  readonly title: ReactNode;
}

const sectionInfo = (section: SettingsSection): SectionInfo => {
  switch (section) {
    case "profile":
      return {
        content: <ProfileSettings />,
        icon: <UserIcon />,
        label: <Trans>Profile and language</Trans>,
        title: <Trans>Profile and language</Trans>,
      };
    case "keys":
      return {
        content: <PersonalKeys />,
        description: (
          <Trans>
            Your own keys pay for your Personal chats, and for team or org chats
            when the org allows it.
          </Trans>
        ),
        icon: <KeyRoundIcon />,
        label: <Trans>Provider keys</Trans>,
        title: <Trans>Provider keys</Trans>,
      };
    case "memory":
      return {
        content: <MemorySettings />,
        description: (
          <Trans>What agents remember about you across chats.</Trans>
        ),
        icon: <BrainIcon />,
        label: <Trans>Memory</Trans>,
        title: <Trans>Memory</Trans>,
      };
    case "shortcuts":
      return {
        content: <ShortcutsEditor />,
        description: (
          <Trans>
            Record your own keys for any shortcut. Your changes are saved in
            this browser.
          </Trans>
        ),
        icon: <KeyboardIcon />,
        label: <Trans>Shortcuts</Trans>,
        title: <Trans>Keyboard shortcuts</Trans>,
      };
    case "appearance":
      return {
        content: <AppearanceSettings />,
        description: <Trans>How the app looks on this device.</Trans>,
        icon: <PaletteIcon />,
        label: <Trans>Appearance</Trans>,
        title: <Trans>Appearance</Trans>,
      };
    default: {
      const unreachable: never = section;
      return unreachable;
    }
  }
};

const itemClass =
  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-start text-muted-foreground text-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 [&_svg]:size-4 [&_svg]:shrink-0";

const SectionList = ({
  current,
  onOpenAdmin,
  onSelect,
}: {
  readonly current: SettingsSection | null;
  readonly onOpenAdmin?: () => void;
  readonly onSelect: (section: SettingsSection) => void;
}) => {
  const { t } = useLingui();
  const select = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const picked = settingsSectionSchema.safeParse(
        event.currentTarget.dataset.section
      );
      if (picked.success) {
        onSelect(picked.data);
      }
    },
    [onSelect]
  );
  return (
    <nav aria-label={t`Settings sections`}>
      <ul className="flex flex-col gap-0.5">
        {settingsSectionSchema.options.map((section) => {
          const info = sectionInfo(section);
          const selected = section === current;
          return (
            <li key={section}>
              <button
                aria-current={selected ? "page" : undefined}
                className={cn(
                  itemClass,
                  selected && "bg-muted text-foreground"
                )}
                data-section={section}
                onClick={select}
                type="button"
              >
                {info.icon}
                {info.label}
              </button>
            </li>
          );
        })}
        {onOpenAdmin ? (
          <li>
            <button className={itemClass} onClick={onOpenAdmin} type="button">
              <ShieldIcon />
              <Trans>Admin</Trans>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
};

export const SettingsDialog = ({
  onClose,
  onOpenAdmin,
  onSelect,
  route,
}: {
  readonly onClose: () => void;
  /** Admin is its own pages; offered only to those who can reach them. */
  readonly onOpenAdmin?: () => void;
  /** `undefined` is the section list (narrow screens). */
  readonly onSelect: (section: SettingsSection | undefined) => void;
  readonly route: SettingsRoute;
}) => {
  const narrow = useNarrowScreen();
  // What it last showed, so closing fades out the section rather than nothing.
  const [shown, setShown] = useState<SettingsRoute>(route);
  if (route !== null && route !== shown) {
    setShown(route);
  }
  const open = route !== null;
  const showing = shown ?? "index";
  const fallback = narrow ? null : DEFAULT_SETTINGS_SECTION;
  const section = showing === "index" ? fallback : showing;
  const info = section ? sectionInfo(section) : null;

  const openChange = useCallback(
    (next: boolean) => {
      if (!next) {
        onClose();
      }
    },
    [onClose]
  );
  const backToList = useCallback(() => onSelect(undefined), [onSelect]);

  return (
    <Dialog onOpenChange={openChange} open={open}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 md:h-[min(80vh,44rem)] md:max-w-3xl md:flex-row",
          // Narrow: a full-screen sheet.
          "max-md:inset-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none"
        )}
      >
        {narrow && info ? (
          // One thing at a time: the section, with the dialog still named.
          <DialogTitle className="sr-only">
            <Trans>Settings</Trans>
          </DialogTitle>
        ) : (
          <div className="flex shrink-0 flex-col gap-3 p-3 md:w-52 md:border-border md:border-e md:bg-muted/30">
            <DialogTitle className="px-2 pe-10 pt-1.5 md:pe-2">
              <Trans>Settings</Trans>
            </DialogTitle>
            <SectionList
              current={section}
              onOpenAdmin={onOpenAdmin}
              onSelect={onSelect}
            />
          </div>
        )}
        {info ? (
          <section
            aria-labelledby="settings-section-title"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          >
            <div className="flex flex-col gap-6 p-4 md:p-6 md:pe-12">
              {narrow ? (
                <Button
                  className="-ms-2 self-start"
                  onClick={backToList}
                  size="sm"
                  variant="ghost"
                >
                  <ChevronLeftIcon />
                  <Trans>Settings</Trans>
                </Button>
              ) : null}
              <header className="flex flex-col gap-1">
                <h2 className="font-medium text-lg" id="settings-section-title">
                  {info.title}
                </h2>
                {info.description ? (
                  <p className="text-muted-foreground text-sm">
                    {info.description}
                  </p>
                ) : null}
              </header>
              {info.content}
            </div>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
