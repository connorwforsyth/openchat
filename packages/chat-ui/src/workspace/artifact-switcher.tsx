"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type {
  ArtifactId,
  ConversationId,
} from "@workspace/contract/schemas/common";
import type { Artifact } from "@workspace/contract/schemas/files";
import {
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  ShapesIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { type ReactNode, useCallback, useState } from "react";

import { KindIcon } from "../artifacts/kind-icon";
import { ShortcutHint } from "../shortcuts/shortcut-hint";

// The artifact view's way to the others (171), as ChatGPT's canvas has one:
// the chat's artifacts, a few recent ones from other chats, and the
// Artifacts page. Its shortcuts are { and }, shown on the menu's label.

/** Where the panel's artifacts lead outside it; the app names the routes. */
export interface WorkspaceArtifactLinks {
  /** The Artifacts page. */
  readonly all: string;
  /** An artifact's own page, full screen. */
  readonly fullView: (id: ArtifactId) => string;
  /** A chat with an artifact open in its panel. */
  readonly inChat: (conversationId: ConversationId, id: ArtifactId) => string;
  readonly navigate: (href: string) => void;
}

/** Recent artifacts from other chats the menu lists. */
const RECENT_ELSEWHERE = 5;
/** Asked for: the list is mixed with this chat's, which are left out. */
const RECENT_FETCHED = 20;

export function ArtifactSwitcher({
  api,
  artifacts,
  current,
  links,
  onSelect,
}: {
  readonly api?: QueryUtils;
  /** This chat's artifacts, in the panel's order. */
  readonly artifacts: readonly Artifact[];
  readonly current: ArtifactId | undefined;
  readonly links?: WorkspaceArtifactLinks;
  readonly onSelect: (id: ArtifactId) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const pick = useCallback(
    (value: unknown) => {
      const found = artifacts.find((artifact) => artifact.id === value);
      if (found) {
        onSelect(found.id);
      }
    },
    [artifacts, onSelect]
  );
  const conversationId = artifacts[0]?.conversationId;

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Switch artifact`}
            className="shrink-0"
            size="icon-sm"
            title={t`Switch artifact`}
            variant="ghost"
          />
        }
      >
        <ChevronsUpDownIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <span className="flex-1">
              <Trans>In this chat</Trans>
            </span>
            <ShortcutHint id="artifact.prev" />
            <ShortcutHint id="artifact.next" />
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={pick} value={current ?? ""}>
            {artifacts.map((artifact) => (
              <DropdownMenuRadioItem
                closeOnClick
                key={artifact.id}
                value={artifact.id}
              >
                <KindIcon
                  className="text-muted-foreground"
                  kind={artifact.kind}
                />
                <span className="min-w-0 flex-1 truncate">
                  {artifact.title}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {links ? (
          <>
            {api && open ? (
              <RecentElsewhere
                api={api}
                conversationId={conversationId}
                links={links}
              />
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <LinkItem href={links.all} navigate={links.navigate}>
                <ShapesIcon aria-hidden />
                <Trans>All artifacts</Trans>
              </LinkItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Fetched when the menu opens: most recently viewed first (`listAll`). */
function RecentElsewhere({
  api,
  conversationId,
  links,
}: {
  readonly api: QueryUtils;
  readonly conversationId: ConversationId | undefined;
  readonly links: WorkspaceArtifactLinks;
}) {
  const recent = useQuery(
    api.artifacts.listAll.queryOptions({
      input: { limit: RECENT_FETCHED, scope: "all" },
    })
  );
  const items = (recent.data?.items ?? [])
    .filter(
      (item) => item.conversationId !== conversationId && item.canGoToChat
    )
    .slice(0, RECENT_ELSEWHERE);
  if (recent.isSuccess && items.length === 0) {
    return null;
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>
          <Trans>Recent in other chats</Trans>
        </DropdownMenuLabel>
        {recent.isPending ? (
          <DropdownMenuItem disabled>
            <Trans>Loading…</Trans>
          </DropdownMenuItem>
        ) : null}
        {items.map((item) => (
          <LinkItem
            href={links.inChat(item.conversationId, item.id)}
            key={item.id}
            navigate={links.navigate}
          >
            <KindIcon className="text-muted-foreground" kind={item.kind} />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <DropdownMenuShortcut>
              <ExternalLinkIcon aria-hidden />
            </DropdownMenuShortcut>
          </LinkItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}

/** Opens the artifact on its own page, the whole window to itself. */
export function OpenFullScreenButton({
  id,
  links,
}: {
  readonly id: ArtifactId;
  readonly links: WorkspaceArtifactLinks;
}) {
  const { t } = useLingui();
  const { fullView, navigate } = links;
  const go = useCallback(
    () => navigate(fullView(id)),
    [fullView, id, navigate]
  );
  return (
    <Button
      aria-label={t`Open full screen`}
      className="shrink-0"
      onClick={go}
      size="icon-sm"
      title={t`Open full screen`}
      variant="ghost"
    >
      <ExternalLinkIcon aria-hidden />
    </Button>
  );
}

/**
 * The chat's artifacts as a strip of tabs over the view (171, after
 * ChatGPT's side panel): one press to switch, the kind's icon and the title.
 * Shown when there's more than one; { and } step along it.
 */
export function ArtifactTabs({
  artifacts,
  current,
  onSelect,
}: {
  readonly artifacts: readonly Artifact[];
  readonly current: ArtifactId | undefined;
  readonly onSelect: (id: ArtifactId) => void;
}) {
  const { t } = useLingui();
  if (artifacts.length < 2) {
    return null;
  }
  return (
    <nav
      aria-label={t`Artifacts in this chat`}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1"
      data-slot="artifact-tabs"
    >
      {artifacts.map((artifact) => (
        <ArtifactTab
          artifact={artifact}
          current={artifact.id === current}
          key={artifact.id}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function ArtifactTab({
  artifact,
  current,
  onSelect,
}: {
  readonly artifact: Artifact;
  readonly current: boolean;
  readonly onSelect: (id: ArtifactId) => void;
}) {
  const select = useCallback(
    () => onSelect(artifact.id),
    [artifact.id, onSelect]
  );
  return (
    <Button
      aria-current={current ? "page" : undefined}
      className="max-w-48 shrink-0 aria-[current=page]:bg-muted"
      onClick={select}
      size="sm"
      title={artifact.title}
      variant="ghost"
    >
      <KindIcon className="text-muted-foreground" kind={artifact.kind} />
      <span className="min-w-0 truncate">{artifact.title}</span>
    </Button>
  );
}

/** A menu item that goes somewhere in the app. */
function LinkItem({
  children,
  href,
  navigate,
}: {
  readonly children: ReactNode;
  readonly href: string;
  readonly navigate: (href: string) => void;
}) {
  const go = useCallback(() => navigate(href), [href, navigate]);
  return <DropdownMenuItem onClick={go}>{children}</DropdownMenuItem>;
}
