"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useNarrowScreen } from "@workspace/chat-ui/shell/use-narrow-screen";
import type { Terms } from "@workspace/config/terms";
import type { OrgId } from "@workspace/contract/schemas/common";
import type { Space } from "@workspace/contract/schemas/spaces";
import {
  ArrowLeftIcon,
  BrainIcon,
  ChevronLeftIcon,
  EyeIcon,
  KeyboardIcon,
  KeyRoundIcon,
  NetworkIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
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

import { AuditPolicy } from "@/app/(app)/(pages)/admin/_components/audit-policy";
import { OrgPolicyForm } from "@/app/(app)/(pages)/admin/_components/org-policy-form";
import { UsageAdmin } from "@/app/(app)/(pages)/admin/_components/usage-admin";
import { useTerms } from "../terms";
import { AppearanceSettings } from "./appearance-settings";
import { McpSettings } from "./mcp/mcp-settings";
import { MemorySettings } from "./memory-settings";
import { PersonalKeys } from "./personal-keys";
import { ProfileSettings } from "./profile-settings";
import {
  DEFAULT_SETTINGS_SECTION,
  PERSONAL_SECTIONS,
  type SettingsRoute,
  type SettingsSection,
  SPACE_SECTIONS,
  settingsSectionSchema,
} from "./settings-route";
import {
  SpaceAllowance,
  SpaceKeys,
  SpaceMembers,
  SubSpaces,
} from "./space-settings";

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

/** Whether a space section applies to the active space. */
const spaceSectionShown = (
  section: SettingsSection,
  space: Space | undefined
): boolean => {
  if (!space || space.isPersonal) {
    return false;
  }
  switch (section) {
    case "space-keys":
      return space.canManage;
    case "space-budgets":
    case "space-policies":
    case "space-audit":
      // Policies and audit are a root space's (the org's, D17).
      return space.type === "org" && space.canManage;
    default:
      return true;
  }
};

const sectionInfo = (
  section: SettingsSection,
  terms: Terms,
  space?: Space
): SectionInfo => {
  const name = space?.name ?? "";
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
    case "space-members":
      return {
        content: <SpaceMembers />,
        description: (
          <Trans>
            Who is in {name}. Owners and admins bring people in and set their
            roles.
          </Trans>
        ),
        icon: <UsersIcon />,
        label: <Trans>Members</Trans>,
        title: <Trans>Members of {name}</Trans>,
      };
    case "space-subspaces":
      return {
        content: <SubSpaces />,
        description: (
          <Trans>
            What's shared in {name} is visible in every space below it, never
            above or beside it.
          </Trans>
        ),
        icon: <NetworkIcon />,
        label: <Trans>Sub-spaces</Trans>,
        title: <Trans>Sub-spaces of {name}</Trans>,
      };
    case "space-allowance":
      return {
        content: <SpaceAllowance />,
        description: (
          <Trans>
            A monthly token pool for {name}. Members draw on it once an owner
            approves their request.
          </Trans>
        ),
        icon: <WalletIcon />,
        label: <Trans>Token allowance</Trans>,
        title: <Trans>Token allowance</Trans>,
      };
    case "space-keys":
      return {
        content: <SpaceKeys />,
        description: (
          <Trans>
            Provider keys {name}'s chats use, and the tokens each one has paid
            for this month.
          </Trans>
        ),
        icon: <KeyRoundIcon />,
        label: <Trans>Keys and usage</Trans>,
        title: <Trans>Keys and usage</Trans>,
      };
    case "space-budgets":
      return {
        content: space ? <UsageAdmin orgId={space.id as OrgId} /> : null,
        description: (
          <Trans>
            Spending limits in money for {name}, its sub-spaces and members.
          </Trans>
        ),
        icon: <WalletIcon />,
        label: <Trans>Budgets and usage</Trans>,
        title: <Trans>Budgets and usage</Trans>,
      };
    case "space-policies":
      return {
        content: space ? <OrgPolicyForm orgId={space.id as OrgId} /> : null,
        description: (
          <Trans>
            Choices for {name}, within the limits this server's configuration
            sets.
          </Trans>
        ),
        icon: <ShieldIcon />,
        label: <Trans>Policies</Trans>,
        title: <Trans>Policies</Trans>,
      };
    case "space-audit":
      return {
        content: space ? <AuditPolicy orgId={space.id as OrgId} /> : null,
        icon: <EyeIcon />,
        label: <Trans>Audit policy</Trans>,
        title: <Trans>Audit policy</Trans>,
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
  space,
}: {
  readonly current: SettingsSection | null;
  readonly space: Space | undefined;
  readonly onClose: () => void;
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
    <nav aria-label={t`Settings sections`} className="flex flex-col gap-3">
      <button className={itemClass} onClick={onClose} type="button">
        <ArrowLeftIcon />
        <Trans>Back to app</Trans>
      </button>
      <ul className="flex flex-col gap-0.5">
        {PERSONAL_SECTIONS.map((section) => (
          <SectionItem
            key={section}
            onSelect={select}
            section={section}
            selected={section === current}
            space={space}
          />
        ))}
        {onOpenAdmin ? (
          <li>
            <button className={itemClass} onClick={onOpenAdmin} type="button">
              <ShieldIcon />
              <Trans>Admin</Trans>
            </button>
          </li>
        ) : null}
      </ul>
      {space && !space.isPersonal ? (
        <div className="flex flex-col gap-1">
          <h2 className="px-2 font-medium text-muted-foreground text-xs">
            <Trans>Space: {space.name}</Trans>
          </h2>
          <ul className="flex flex-col gap-0.5">
            {SPACE_SECTIONS.filter((section) =>
              spaceSectionShown(section, space)
            ).map((section) => (
              <SectionItem
                key={section}
                onSelect={select}
                section={section}
                selected={section === current}
                space={space}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
};

const SectionItem = ({
  onSelect,
  section,
  selected,
  space,
}: {
  readonly onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly section: SettingsSection;
  readonly selected: boolean;
  readonly space: Space | undefined;
}) => {
  const terms = useTerms();
  const info = sectionInfo(section, terms, space);
  return (
    <li>
      <button
        aria-current={selected ? "page" : undefined}
        className={cn(
          itemClass,
          selected && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
        data-section={section}
        onClick={onSelect}
        type="button"
      >
        {info.icon}
        {info.label}
      </button>
    </li>
  );
};

export const SettingsView = ({
  onClose,
  onOpenAdmin,
  onSelect,
  route,
  space,
}: {
  readonly onClose: () => void;
  /** Admin is its own pages; offered only to those who can reach them. */
  readonly onOpenAdmin?: () => void;
  /** `undefined` is the section list (narrow screens). */
  readonly onSelect: (section: SettingsSection | undefined) => void;
  readonly route: SettingsRoute;
  /** The active space (the sidebar switcher's); its sections follow yours. */
  readonly space?: Space;
}) => {
  const narrow = useNarrowScreen();
  const terms = useTerms();
  const open = route !== null;
  const showing = route ?? "index";
  const fallback = narrow ? null : DEFAULT_SETTINGS_SECTION;
  const section = showing === "index" ? fallback : showing;
  const info = section ? sectionInfo(section, terms, space) : null;

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
              space={space}
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
