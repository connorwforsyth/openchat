"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useNarrowScreen } from "@workspace/chat-ui/shell/use-narrow-screen";
import type { Terms } from "@workspace/config/terms";
import {
  ArrowLeftIcon,
  BrainIcon,
  ChevronLeftIcon,
  KeyboardIcon,
  KeyRoundIcon,
  NetworkIcon,
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
import { type MouseEvent, type ReactNode, useCallback } from "react";
import { useTerms } from "../terms";
import { AppearanceSettings } from "./appearance-settings";
import { McpSettings } from "./mcp/mcp-settings";
import { MemorySettings } from "./memory-settings";
import { PersonalKeys } from "./personal-keys";
import { ProfileSettings } from "./profile-settings";
import {
  DEFAULT_SETTINGS_SECTION,
  type SettingsRoute,
  type SettingsSection,
  settingsSectionSchema,
} from "./settings-route";

// Settings as a full-screen view (185): while it's open the app sidebar is
// replaced by the settings sidebar ("Back to app", then the sections) and the
// section gets the whole content area, at a reading width. Never two
// sidebars side by side. Below `md` it shows one thing at a time: the list,
// then a section with a way back to the list.
//
// It's built on the Dialog primitive for what a modal surface needs (focus
// moves in and is kept there, Esc closes, focus returns to the trigger), but
// it isn't drawn as one. ⌘, opens it and keyboard toggles don't animate, so
// it neither appears nor leaves with motion.

interface SectionInfo {
  readonly content: ReactNode;
  readonly description?: ReactNode;
  readonly icon: ReactNode;
  readonly label: ReactNode;
  readonly title: ReactNode;
}

const sectionInfo = (section: SettingsSection, terms: Terms): SectionInfo => {
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
    case "mcp": {
      // The configured name (191), a heading as given.
      const { label } = terms.mcp;
      return {
        content: <McpSettings />,
        description: (
          <Trans>
            {label} give chats extra tools. Turn on the ones you want; your
            administrator may require some or let you add your own.
          </Trans>
        ),
        icon: <NetworkIcon />,
        label,
        title: label,
      };
    }
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
  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-start text-muted-foreground text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 [&_svg]:size-4 [&_svg]:shrink-0";

const SectionList = ({
  current,
  onClose,
  onOpenAdmin,
  onSelect,
}: {
  readonly current: SettingsSection | null;
  readonly onClose: () => void;
  readonly onOpenAdmin?: () => void;
  readonly onSelect: (section: SettingsSection) => void;
}) => {
  const { t } = useLingui();
  const terms = useTerms();
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
    <nav aria-label={t`Settings sections`} className="flex flex-col gap-3">
      <button className={itemClass} onClick={onClose} type="button">
        <ArrowLeftIcon />
        <Trans>Back to app</Trans>
      </button>
      <ul className="flex flex-col gap-0.5">
        {settingsSectionSchema.options.map((section) => {
          const info = sectionInfo(section, terms);
          const selected = section === current;
          return (
            <li key={section}>
              <button
                aria-current={selected ? "page" : undefined}
                className={cn(
                  itemClass,
                  selected && "bg-sidebar-accent text-sidebar-accent-foreground"
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

export const SettingsView = ({
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
  const terms = useTerms();
  const open = route !== null;
  const showing = route ?? "index";
  const fallback = narrow ? null : DEFAULT_SETTINGS_SECTION;
  const section = showing === "index" ? fallback : showing;
  const info = section ? sectionInfo(section, terms) : null;

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
          // A view, not a dialog: the whole window, no frame, no motion.
          "inset-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-background p-0 text-foreground ring-0 data-closed:animate-none sm:max-w-none",
          "max-md:flex-col"
        )}
        showCloseButton={false}
      >
        {narrow && info ? (
          // One thing at a time: the section, with the view still named.
          <DialogTitle className="sr-only">
            <Trans>Settings</Trans>
          </DialogTitle>
        ) : (
          <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto bg-sidebar p-3 text-sidebar-foreground max-md:flex-1 md:w-[var(--app-sidebar-width,260px)] md:border-sidebar-border md:border-e">
            <DialogTitle className="sr-only">
              <Trans>Settings</Trans>
            </DialogTitle>
            <SectionList
              current={section}
              onClose={onClose}
              onOpenAdmin={onOpenAdmin}
              onSelect={onSelect}
            />
          </aside>
        )}
        {info ? (
          <section
            aria-labelledby="settings-section-title"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-12">
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
                <h1
                  className="font-medium text-2xl"
                  id="settings-section-title"
                >
                  {info.title}
                </h1>
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
