"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ComposerLoader,
  type ComposerLoaderProps,
} from "@workspace/composer/components/composer-loader";
import { ContextChip } from "@workspace/composer/components/context-chip";
import type { ContextOption } from "@workspace/composer/schemas";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Participant } from "@workspace/contract/schemas/conversations";
import type {
  Message,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { FileTextIcon, NewChatIcon, PanelLeftIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import type { ArtifactsPanelProps } from "../artifacts/artifacts-panel";
import { LazyArtifactsPanel } from "../artifacts/lazy-artifacts-panel";
import type { ConversationActions } from "../conversation/actions";
import { ConversationView } from "../conversation/conversation-view";
import type { MessageFeedback } from "../conversation/feedback";
import { AppHeader } from "../header/app-header";
import { BranchSwitcher } from "../header/branch-switcher";
import { ChatTitle } from "../header/chat-title";
import { HeaderOverflowMenu } from "../header/overflow-menu";
import { SandboxPill } from "../header/sandbox-pill";
import { Participants, ShareMenu } from "../header/share-menu";
import { activeFork, stepSibling } from "../model/branch";
import { groupChats, orderedChats } from "../model/date-groups";
import type { RightPanel as RightPanelKind } from "../model/layout";
import type { ArtifactRefPart } from "../model/parts";
import { LazySandboxPanel } from "../sandbox/lazy-sandbox-panel";
import type { SandboxPanelProps } from "../sandbox/sandbox-panel";
import { AppShell } from "../shell/app-shell";
import { type Platform, PlatformProvider } from "../shell/platform";
import { RightPanel } from "../shell/right-panel";
import { useNarrowScreen } from "../shell/use-narrow-screen";
import {
  type ShellLayoutState,
  useShellLayout,
} from "../shell/use-shell-layout";
import { ShortcutHelp } from "../shortcuts/shortcut-help";
import { ShortcutHint } from "../shortcuts/shortcut-hint";
import { useShortcuts } from "../shortcuts/use-shortcuts";
import { ChatSidebar, type ChatSidebarProps } from "../sidebar/chat-sidebar";

// The whole chat screen, presentational: the app shell with the sidebar,
// header, conversation, docked composer and the Sandbox / Artifacts panel,
// plus the single-key shortcuts. Every piece of data and every action comes
// in through props; `ConnectedChat` supplies them from the API.

export interface ChatScreenConversation {
  readonly context: ChatContext;
  /** Fixed after the first message (D17). */
  readonly contextLocked: boolean;
  readonly contextOptions: readonly ContextOption[];
  /** `null` for a chat that hasn't been created yet. */
  readonly id: ConversationId | null;
  readonly onContextChange?: (context: ChatContext) => void;
  readonly onCopyLink?: () => Promise<void> | void;
  readonly onInvite?: () => void;
  readonly onRename?: (title: string) => void;
  readonly participants: readonly Participant[];
  readonly title: string | null;
}

export interface ChatScreenProps {
  readonly actions: ConversationActions;
  readonly artifacts: Omit<ArtifactsPanelProps, "onSelect"> & {
    readonly onSelect: ArtifactsPanelProps["onSelect"];
  };
  readonly brand?: ReactNode;
  readonly composer: ComposerLoaderProps;
  readonly conversation: ChatScreenConversation;
  readonly feedback?: Readonly<Record<string, MessageFeedback>>;
  /**
   * The shell's layout when the app owns it, so it survives leaving the chat
   * for another page with the same shell and can be restored before paint.
   * Omitted, the screen keeps its own.
   */
  readonly layout?: ShellLayoutState;
  readonly messages: readonly Message[];
  readonly onNewChat: () => void;
  /** Opens the ⌘K palette (ticket 024). */
  readonly onOpenPalette?: () => void;
  readonly pendingApprovals?: readonly PendingApproval[];
  readonly platform?: Platform;
  /** A run-level error to show after the last message. */
  readonly runError?: ReactNode;
  /** `null` when sandboxes are off for this instance. */
  readonly sandbox: SandboxPanelProps | null;
  readonly siblings: readonly SiblingInfo[];
  readonly sidebar: Omit<
    ChatSidebarProps,
    "brand" | "onNewChat" | "onOpenPalette"
  >;
  readonly streamingMessageId?: ChatScreenStreamingId;
}

type ChatScreenStreamingId = Message["id"] | null;

const FOCUSABLE_INPUT = '[contenteditable="true"], textarea';

function NewChatIntro() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-balance font-medium text-2xl tracking-tight">
        <Trans>What are we working on?</Trans>
      </h2>
      <p className="max-w-md text-pretty text-muted-foreground text-sm">
        <Trans>
          Pick whose keys and budget this chat uses with the context in the
          header. You can change it until you send the first message.
        </Trans>
      </p>
    </div>
  );
}

function ChatScreenBody({
  actions,
  artifacts,
  brand,
  composer,
  conversation,
  feedback,
  layout: sharedLayout,
  messages,
  onNewChat,
  onOpenPalette,
  pendingApprovals,
  platform = "web",
  runError,
  sandbox,
  sidebar,
  siblings,
  streamingMessageId = null,
}: ChatScreenProps) {
  const { t } = useLingui();
  // Hooks can't be conditional, so the screen's own layout always exists; it
  // just goes unused when the app passes one in.
  const ownLayout = useShellLayout();
  const { layout, setPanel, setPanelWidth, togglePanel, toggleSidebar } =
    sharedLayout ?? ownLayout;
  const narrow = useNarrowScreen();
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  // The panel a narrow screen's sheet shows, kept after it's dismissed so the
  // sheet fades out with its content.
  const [sheetPanel, setSheetPanel] = useState<RightPanelKind>("artifacts");
  if (layout.panel !== null && layout.panel !== sheetPanel) {
    setSheetPanel(layout.panel);
  }
  const [helpOpen, setHelpOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const fork = activeFork(siblings);

  const order = useMemo(
    () => orderedChats(groupChats(sidebar.chats, sidebar.now ?? new Date())),
    [sidebar.chats, sidebar.now]
  );

  const stepChat = useCallback(
    (delta: -1 | 1) => {
      const at = order.findIndex((chat) => chat.id === sidebar.activeId);
      const next = order[at === -1 ? 0 : at + delta];
      if (next) {
        sidebar.onSelect(next.id);
      }
    },
    [order, sidebar]
  );
  const stepBranch = useCallback(
    (delta: -1 | 1) => {
      const target = fork ? stepSibling(fork, delta) : null;
      if (target) {
        actions.onSelectBranch?.(target);
      }
    },
    [actions, fork]
  );
  // A wide screen shows or hides the sidebar (and remembers it); a narrow one
  // opens it as a sheet over the chat.
  const toggleChats = useCallback(() => {
    if (narrow) {
      setSidebarSheetOpen((open) => !open);
    } else {
      toggleSidebar();
    }
  }, [narrow, toggleSidebar]);
  const closeSidebarSheet = useCallback(() => setSidebarSheetOpen(false), []);
  // Picking a chat, starting one or searching is done with the sheet.
  const sheetSidebar = useMemo(
    () => ({
      ...sidebar,
      onSelect: (id: ConversationId) => {
        closeSidebarSheet();
        sidebar.onSelect(id);
      },
    }),
    [closeSidebarSheet, sidebar]
  );
  const newChat = useCallback(() => {
    closeSidebarSheet();
    onNewChat();
  }, [closeSidebarSheet, onNewChat]);
  const openPalette = useMemo(
    () =>
      onOpenPalette
        ? () => {
            closeSidebarSheet();
            onOpenPalette();
          }
        : undefined,
    [closeSidebarSheet, onOpenPalette]
  );
  const closePanel = useCallback(() => setPanel(null), [setPanel]);

  const focusComposer = useCallback(() => {
    composerRef.current?.querySelector<HTMLElement>(FOCUSABLE_INPUT)?.focus();
  }, []);

  useShortcuts({
    "branch.next": () => stepBranch(1),
    "branch.prev": () => stepBranch(-1),
    "chat.new": onNewChat,
    "chat.next": () => stepChat(1),
    "chat.prev": () => stepChat(-1),
    "composer.focus": focusComposer,
    help: () => setHelpOpen(true),
    "palette.open": onOpenPalette,
    "panel.artifacts": () => togglePanel("artifacts"),
    "panel.sandbox": sandbox ? () => togglePanel("sandbox") : undefined,
    "sidebar.toggle": toggleChats,
  });

  // Opening an artifact from a message shows it in the panel.
  const openArtifact = useCallback(
    (ref: ArtifactRefPart) => {
      setPanel("artifacts");
      artifacts.onSelect({
        artifactId: ref.artifactId,
        versionId: ref.versionId,
      });
      actions.onOpenArtifact?.(ref);
    },
    [actions, artifacts, setPanel]
  );
  const conversationActions = useMemo(
    () => ({ ...actions, onOpenArtifact: openArtifact }),
    [actions, openArtifact]
  );

  const openSandbox = useCallback(() => togglePanel("sandbox"), [togglePanel]);
  const openArtifacts = useCallback(
    () => togglePanel("artifacts"),
    [togglePanel]
  );

  const header = (
    <AppHeader
      center={
        <>
          <ChatTitle
            onRename={conversation.onRename}
            title={conversation.title}
          />
          <BranchSwitcher
            info={fork}
            onSelect={actions.onSelectBranch ?? noop}
            size="sm"
          />
        </>
      }
      end={
        <>
          {/* On a narrow screen a locked context is just a label, so it
              gives its room to the title; an open one is still a choice.
              The CSS covers the moment before hydration knows the width. */}
          {narrow && conversation.contextLocked ? null : (
            <div
              className={cn(
                "flex items-center",
                conversation.contextLocked && "max-md:hidden"
              )}
            >
              <ContextChip
                locked={conversation.contextLocked}
                onChange={conversation.onContextChange}
                options={conversation.contextOptions}
                value={conversation.context}
              />
            </div>
          )}
          <Participants participants={conversation.participants} />
          {narrow ? (
            <HeaderOverflowMenu
              artifactsOpen={layout.panel === "artifacts"}
              onCopyLink={conversation.onCopyLink}
              onInvite={conversation.onInvite}
              onToggleArtifacts={openArtifacts}
              onToggleSandbox={sandbox ? openSandbox : undefined}
              sandboxOpen={layout.panel === "sandbox"}
              shareDisabled={conversation.id === null}
            />
          ) : (
            <div className="flex items-center gap-1 max-md:hidden">
              <ShareMenu
                disabled={conversation.id === null}
                onCopyLink={conversation.onCopyLink}
                onInvite={conversation.onInvite}
                participants={conversation.participants}
              />
              {sandbox ? (
                <SandboxPill
                  onOpen={openSandbox}
                  open={layout.panel === "sandbox"}
                  sandbox={sandbox.initial}
                />
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={t`Artifacts panel`}
                      aria-pressed={layout.panel === "artifacts"}
                      onClick={openArtifacts}
                      size="icon-sm"
                      variant="ghost"
                    />
                  }
                >
                  <FileTextIcon aria-hidden />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <Trans>Artifacts panel</Trans>
                  <ShortcutHint id="panel.artifacts" />
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </>
      }
      start={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-expanded={narrow ? sidebarSheetOpen : layout.sidebarOpen}
                  aria-label={t`Toggle sidebar`}
                  onClick={toggleChats}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <PanelLeftIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <Trans>Toggle sidebar</Trans>
              <ShortcutHint id="sidebar.toggle" />
            </TooltipContent>
          </Tooltip>
          {layout.sidebarOpen && !narrow ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t`New chat`}
                    onClick={onNewChat}
                    size="icon-sm"
                    variant="ghost"
                  />
                }
              >
                <NewChatIcon aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <Trans>New chat</Trans>
                <ShortcutHint id="chat.new" />
              </TooltipContent>
            </Tooltip>
          )}
        </>
      }
      underWindowControls={!layout.sidebarOpen}
    />
  );

  const panel = (
    <RightPanel
      artifacts={<LazyArtifactsPanel {...artifacts} />}
      onPanelChange={setPanel}
      panel={layout.panel ?? sheetPanel}
      sandbox={
        sandbox ? (
          <LazySandboxPanel {...sandbox} />
        ) : (
          <p className="p-4 text-muted-foreground text-sm">
            <Trans>Sandboxes are turned off on this server.</Trans>
          </p>
        )
      }
    />
  );

  return (
    <AppShell
      header={header}
      onPanelClose={closePanel}
      onPanelWidthChange={setPanelWidth}
      onSidebarSheetOpenChange={setSidebarSheetOpen}
      panel={panel}
      panelOpen={layout.panel !== null}
      panelWidth={layout.panelWidth}
      platform={platform}
      sidebar={
        <ChatSidebar
          {...sheetSidebar}
          brand={brand}
          onNewChat={newChat}
          onOpenPalette={openPalette}
        />
      }
      sidebarOpen={layout.sidebarOpen}
      sidebarSheetOpen={sidebarSheetOpen}
    >
      <ConversationView
        actions={conversationActions}
        conversationKey={conversation.id ?? "new"}
        empty={<NewChatIntro />}
        error={runError}
        feedback={feedback}
        messages={messages}
        pendingApprovals={pendingApprovals}
        siblings={siblings}
        streamingMessageId={streamingMessageId}
      />
      <div
        className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-[max(--spacing(4),env(safe-area-inset-bottom))]"
        ref={composerRef}
      >
        <ComposerLoader {...composer} />
      </div>
      <ShortcutHelp onOpenChange={setHelpOpen} open={helpOpen} />
    </AppShell>
  );
}

const noop = () => undefined;

/**
 * The chat screen. The platform wraps everything so the shortcut hook, which
 * lives above the shell, knows whether ⌘ or Ctrl is the modifier.
 */
export function ChatScreen(props: ChatScreenProps) {
  return (
    <PlatformProvider platform={props.platform}>
      <ChatScreenBody {...props} />
    </PlatformProvider>
  );
}
