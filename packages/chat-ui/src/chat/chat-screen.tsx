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
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import type { ArtifactsPanelProps } from "../artifacts/artifacts-panel";
import { LazyArtifactsPanel } from "../artifacts/lazy-artifacts-panel";
import type { ConversationActions } from "../conversation/actions";
import { ConversationView } from "../conversation/conversation-view";
import type { MessageFeedback } from "../conversation/feedback";
import { AppHeader } from "../header/app-header";
import { BranchSwitcher } from "../header/branch-switcher";
import { ChatTitle } from "../header/chat-title";
import { SandboxPill } from "../header/sandbox-pill";
import { Participants, ShareMenu } from "../header/share-menu";
import { activeFork, stepSibling } from "../model/branch";
import { groupChats, orderedChats } from "../model/date-groups";
import type { ArtifactRefPart } from "../model/parts";
import { LazySandboxPanel } from "../sandbox/lazy-sandbox-panel";
import type { SandboxPanelProps } from "../sandbox/sandbox-panel";
import { AppShell } from "../shell/app-shell";
import { type Platform, PlatformProvider } from "../shell/platform";
import { RightPanel } from "../shell/right-panel";
import { useShellLayout } from "../shell/use-shell-layout";
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
  const { layout, setPanel, setPanelWidth, togglePanel, toggleSidebar } =
    useShellLayout();
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
    "sidebar.toggle": toggleSidebar,
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
          <ContextChip
            locked={conversation.contextLocked}
            onChange={conversation.onContextChange}
            options={conversation.contextOptions}
            value={conversation.context}
          />
          <Participants participants={conversation.participants} />
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
        </>
      }
      start={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-expanded={layout.sidebarOpen}
                  aria-label={t`Toggle sidebar`}
                  onClick={toggleSidebar}
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
          {layout.sidebarOpen ? null : (
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

  const panel =
    layout.panel === null ? null : (
      <RightPanel
        artifacts={<LazyArtifactsPanel {...artifacts} />}
        onPanelChange={setPanel}
        panel={layout.panel}
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
      onPanelWidthChange={setPanelWidth}
      panel={panel}
      panelWidth={layout.panelWidth}
      platform={platform}
      sidebar={
        <ChatSidebar
          {...sidebar}
          brand={brand}
          onNewChat={onNewChat}
          onOpenPalette={onOpenPalette}
        />
      }
      sidebarOpen={layout.sidebarOpen}
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
        className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"
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
