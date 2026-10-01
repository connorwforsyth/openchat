"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ComposerLoader,
  type ComposerLoaderProps,
} from "@workspace/composer/components/composer-loader";
import { ContextSummary } from "@workspace/composer/components/context-chip";
import type {
  ComposerCommand,
  ComposerValue,
  ContextOption,
} from "@workspace/composer/schemas";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Participant } from "@workspace/contract/schemas/conversations";
import type {
  Message,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { NewChatIcon, PanelLeftIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  type ComponentProps,
  lazy,
  type ReactNode,
  type Ref,
  Suspense,
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ConversationActions } from "../conversation/actions";
import { ConversationView } from "../conversation/conversation-view";
import { EmptyState } from "../conversation/empty-state";
import type { MessageFeedback } from "../conversation/feedback";
import { FilePreviewContext } from "../conversation/file-change-card";
import { AppHeader } from "../header/app-header";
import { BranchSwitcher } from "../header/branch-switcher";
import { ChatTitle } from "../header/chat-title";
import { HeaderOverflowMenu } from "../header/overflow-menu";
import { ShareMenu } from "../header/share-menu";
import { WorkspaceToggle } from "../header/workspace-toggle";
import { activeFork, stepSibling } from "../model/branch";
import { groupChats, orderedChats } from "../model/date-groups";
import type { WorkspaceSection } from "../model/layout";
import type { ArtifactRefPart } from "../model/parts";
import {
  sectionOf,
  shownSelection,
  type WorkspaceSelection,
  workspacePath,
  workspaceRevision,
} from "../model/workspace";
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
import { LazyWorkspacePanel } from "../workspace/lazy-workspace-panel";
import { type OpeningWatch, watchOpenings } from "../workspace/model/auto-open";
import {
  type BrowserPage,
  defaultPage,
  isHtmlPath,
  NO_SOURCES,
  type PreviewRequest,
  type PreviewSources,
  pageOfUrl,
  pagePathOf,
} from "../workspace/model/browser";
import type { WorkspaceFilesSource } from "../workspace/model/client";
import { toSandboxPath } from "../workspace/model/tree";
import type { WorkspaceArtifacts } from "../workspace/workspace-panel";
import type { SeededBranch } from "./seed";

// The whole chat screen, presentational: the app shell with the sidebar,
// header, conversation, docked composer and the Workspace panel (files,
// preview and artifacts), plus the single-key shortcuts. Every piece of data and every
// action comes in through props; `ConnectedChat` supplies them from the API.
// The look follows shadcn's chatbot template (MIT): a narrow column, muted
// user bubbles, plain assistant prose, a rounded composer.

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

/** The chat's Workspace panel (060), controlled by the host. */
export interface ChatScreenWorkspace {
  readonly artifacts: WorkspaceArtifacts;
  /**
   * Whether the workspace can serve a preview (a just-bash one can't): the
   * composer offers `/preview` only then.
   */
  readonly canPreview?: boolean;
  readonly files: WorkspaceFilesSource;
  readonly onSelect: (selection: WorkspaceSelection | null) => void;
  /**
   * The workspace's files, relative to it (`src/a.ts`), for the composer's
   * `@` mentions and `/open`.
   */
  readonly paths?: readonly string[];
  /** What the panel last had selected; the section it's on decides what shows. */
  readonly selection: WorkspaceSelection | null;
}

/** Opens things in the Workspace panel from outside it (composer commands). */
export interface WorkspaceHandle {
  /** Opens a file; the path may be absolute (`/work/a.md`) or relative. */
  readonly openFile: (path: string) => void;
  /**
   * Opens the Preview: at a workspace page (`index.html`, `/work/a.html`)
   * when given one, else where it was.
   */
  readonly openPreview: (path?: string) => void;
}

export interface ChatScreenProps {
  readonly actions: ConversationActions;
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
  /**
   * The branch the server read (ticket 103), shown while `messages` is still
   * empty. The conversation waits for it under its own Suspense boundary, so
   * the rest of the screen, the composer first, doesn't (D27).
   */
  readonly seededBranch?: SeededBranch;
  readonly siblings: readonly SiblingInfo[];
  readonly sidebar: Omit<
    ChatSidebarProps,
    "brand" | "onNewChat" | "onOpenPalette"
  >;
  readonly streamingMessageId?: ChatScreenStreamingId;
  readonly workspace: ChatScreenWorkspace;
  /** Receives `WorkspaceHandle`, for opening files from the composer. */
  readonly workspaceHandle?: Ref<WorkspaceHandle>;
}

type ChatScreenStreamingId = Message["id"] | null;

const FOCUSABLE_INPUT = '[contenteditable="true"], textarea';

// "New file" from the composer's `/new-file`: loaded the first time it's
// asked for, like the panel it belongs with (D27).
const NewFileDialog = lazy(() =>
  import("../workspace/new-file-dialog").then((module) => ({
    default: module.NewFileDialog,
  }))
);

const FILE_COMMANDS: readonly ComposerCommand[] = ["new-file", "open"];
const ALL_COMMANDS: readonly ComposerCommand[] = [...FILE_COMMANDS, "preview"];
const WHITESPACE = /\s/;

/**
 * Paths the composer can offer: its `@` and `/` triggers are single words,
 * so a path with a space in it can't be typed or matched.
 */
const composerPaths = (paths: readonly string[] | undefined) =>
  (paths ?? []).filter((path) => !WHITESPACE.test(path));

/** The pathname of a URL, or `/`. */
const pathOfUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
};

/** A composer value that says only `text`. */
const textValue = (text: string): ComposerValue => ({
  attachments: [],
  mentions: [],
  templateId: null,
  text,
});

function ChatScreenBody({
  actions,
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
  seededBranch,
  sidebar,
  siblings,
  streamingMessageId = null,
  workspace,
  workspaceHandle,
}: ChatScreenProps) {
  const { t } = useLingui();
  // Hooks can't be conditional, so the screen's own layout always exists; it
  // just goes unused when the app passes one in.
  const ownLayout = useShellLayout();
  const { layout, setPanel, setPanelWidth, togglePanel, toggleSidebar } =
    sharedLayout ?? ownLayout;
  const narrow = useNarrowScreen();
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  // The panel's last section: the Workspace toggle reopens it, and a narrow
  // screen's sheet keeps showing it while it fades out.
  const [lastPanel, setLastPanel] = useState<WorkspaceSection>("files");
  if (layout.panel !== null && layout.panel !== lastPanel) {
    setLastPanel(layout.panel);
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
  // "Closed during this run": the answer being written when the person
  // closed the panel. The agent writing a page then doesn't reopen it.
  const lastAnswer = useRef<string | null>(null);
  useEffect(() => {
    lastAnswer.current =
      messages.filter((message) => message.role === "assistant").at(-1)?.id ??
      null;
  });
  const [closedIn, setClosedIn] = useState<string | null>(null);
  const closingPanel = useCallback(() => setClosedIn(lastAnswer.current), []);
  const closePanel = useCallback(() => {
    closingPanel();
    setPanel(null);
  }, [closingPanel, setPanel]);
  const togglePanelBy = useCallback(
    (toggled: WorkspaceSection) => {
      if (layout.panel === toggled) {
        closingPanel();
      }
      togglePanel(toggled);
    },
    [closingPanel, layout.panel, togglePanel]
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
    "panel.artifacts": () => togglePanelBy("artifacts"),
    "panel.sandbox": () => togglePanelBy("files"),
    "sidebar.toggle": toggleChats,
  });

  // The panel shows the host's selection when it belongs to the section
  // that's open, and that section's default otherwise.
  const section = layout.panel ?? lastPanel;
  const { files, paths } = workspace;
  const sandboxRecord = files.kind === "chat" ? files.sandbox : null;
  const sources = useMemo(
    (): PreviewSources =>
      files.kind === "chat"
        ? {
            htmlPaths: (paths ?? []).filter(isHtmlPath),
            previews: sandboxRecord?.previews ?? [],
            provider: sandboxRecord?.provider ?? null,
          }
        : NO_SOURCES,
    [files.kind, paths, sandboxRecord]
  );
  // A page the chat asked the Preview for; the panel navigates once per id.
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(
    null
  );
  const hasPreview = defaultPage(sources) !== null || previewRequest !== null;
  const shown = shownSelection(section, workspace.selection, hasPreview);
  const { onSelect: selectInWorkspace } = workspace;
  const select = useCallback(
    (selection: WorkspaceSelection | null) => {
      selectInWorkspace(selection);
      if (selection) {
        setPanel(sectionOf(selection));
      }
    },
    [selectInWorkspace, setPanel]
  );
  const revision = useMemo(() => workspaceRevision(messages), [messages]);

  // Opening an artifact or a file from a message shows it in the panel.
  const openArtifact = useCallback(
    (ref: ArtifactRefPart) => {
      select({
        artifactId: ref.artifactId,
        kind: "artifact",
        versionId: ref.versionId,
      });
      actions.onOpenArtifact?.(ref);
    },
    [actions, select]
  );
  const openFile = useCallback(
    (path: string) => {
      select({ kind: "file", path: workspacePath(path) });
      actions.onOpenFile?.(path);
    },
    [actions, select]
  );
  const showPage = useCallback(
    (page: BrowserPage | null) => {
      if (page) {
        setPreviewRequest((last) => ({ id: (last?.id ?? 0) + 1, page }));
      }
      select({ kind: "preview" });
    },
    [select]
  );
  const openPreview = useCallback(
    (path?: string) =>
      showPage(
        path ? { path: pagePathOf(workspacePath(path)), port: null } : null
      ),
    [showPage]
  );
  useImperativeHandle(workspaceHandle, () => ({ openFile, openPreview }), [
    openFile,
    openPreview,
  ]);
  // A preview line's Open shows the recorded preview in the panel; one the
  // record doesn't have (yet) opens in a new tab, as a link would.
  const openPreviewAt = useCallback(
    (url: string) => {
      const page = pageOfUrl(sources, url);
      if (page) {
        showPage(page);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [showPage, sources]
  );
  const previewFile = useCallback(
    (path: string) => openPreview(path),
    [openPreview]
  );

  // The panel opens by itself on the Preview when the agent writes a page
  // or starts a preview (066), unless the person closed it during this run.
  const watch = useRef<OpeningWatch | null>(null);
  const watchedChat = useRef(conversation.id);
  useEffect(() => {
    // Another chat starts from what it has; a new chat getting its id keeps going.
    if (watchedChat.current !== conversation.id) {
      if (watchedChat.current !== null) {
        watch.current = null;
      }
      watchedChat.current = conversation.id;
    }
    const seen = watchOpenings(watch.current, messages, streamingMessageId);
    watch.current = seen.watch;
    const { open } = seen;
    if (
      !open ||
      files.kind !== "chat" ||
      (closedIn !== null && open.messageIds.includes(closedIn))
    ) {
      return;
    }
    showPage(
      open.path === null
        ? (pageOfUrl(sources, open.url ?? "") ?? {
            path: pathOfUrl(open.url ?? ""),
            port: null,
          })
        : { path: pagePathOf(open.path), port: null }
    );
  }, [
    closedIn,
    conversation.id,
    files.kind,
    messages,
    showPage,
    sources,
    streamingMessageId,
  ]);
  const chatWorkspace = files.kind === "chat";
  const conversationActions = useMemo(
    () => ({
      ...actions,
      onOpenArtifact: openArtifact,
      onOpenFile: openFile,
      ...(chatWorkspace ? { onOpenPreview: openPreviewAt } : {}),
    }),
    [actions, chatWorkspace, openArtifact, openFile, openPreviewAt]
  );

  const toggleWorkspace = useCallback(() => {
    if (layout.panel !== null) {
      closingPanel();
    }
    setPanel(layout.panel === null ? lastPanel : null);
  }, [closingPanel, lastPanel, layout.panel, setPanel]);

  // The composer's file commands (061) act on the panel; they exist once
  // the chat does, since its first message creates the workspace.
  const { disabled: composerDisabled, onSubmit } = composer;
  const [newFile, setNewFile] = useState({ asked: false, open: false });
  const setNewFileOpen = useCallback(
    (open: boolean) => setNewFile({ asked: true, open }),
    []
  );
  const alreadyExists = t`A file with that name already exists.`;
  const startPreview = t`Start the app and open a preview`;
  const createFile = useCallback(
    async (path: string): Promise<string | null> => {
      if (files.kind !== "chat") {
        return null;
      }
      const written = await files.client.writeFile({
        content: "",
        ifMatch: null,
        path: toSandboxPath(path),
      });
      if (!written.ok) {
        return written.error.kind === "failed"
          ? written.error.message
          : alreadyExists;
      }
      files.onChanged();
      openFile(path);
      return null;
    },
    [alreadyExists, files, openFile]
  );
  const runCommand = useCallback(
    (command: ComposerCommand, path?: string) => {
      switch (command) {
        case "new-file":
          setNewFileOpen(true);
          return;
        case "open":
          if (path) {
            openFile(path);
          } else {
            setPanel("files");
          }
          return;
        case "preview":
          // Nothing to show yet: ask the agent to start one.
          if (hasPreview) {
            openPreview();
          } else {
            onSubmit(textValue(startPreview));
          }
          return;
        default:
          return command satisfies never;
      }
    },
    [
      hasPreview,
      onSubmit,
      openFile,
      openPreview,
      setNewFileOpen,
      setPanel,
      startPreview,
    ]
  );
  const { canPreview = false } = workspace;
  const workspaceComposer = useMemo(
    () =>
      chatWorkspace
        ? {
            commands: canPreview ? ALL_COMMANDS : FILE_COMMANDS,
            files: composerPaths(paths),
            onCommand: runCommand,
          }
        : null,
    [canPreview, chatWorkspace, paths, runCommand]
  );

  // The context is chosen in the composer until the first message locks it;
  // after that it's a fact about the chat, shown in the Share menu.
  const { contextLocked } = conversation;
  const composerProps = useMemo<ComposerLoaderProps>(
    () => ({
      ...composer,
      ...workspaceComposer,
      ...(contextLocked
        ? {}
        : {
            context: conversation.context,
            contexts: conversation.contextOptions,
            onContextChange: conversation.onContextChange,
          }),
    }),
    [
      composer,
      contextLocked,
      conversation.context,
      conversation.contextOptions,
      conversation.onContextChange,
      workspaceComposer,
    ]
  );
  const lockedContext = contextLocked ? (
    <ContextSummary
      options={conversation.contextOptions}
      value={conversation.context}
    />
  ) : undefined;

  // A suggestion is sent as the first message, as if typed.
  const sendSuggestion = useCallback(
    (prompt: string) => onSubmit(textValue(prompt)),
    [onSubmit]
  );

  const header = (
    <AppHeader
      end={
        narrow ? (
          <HeaderOverflowMenu
            lockedContext={lockedContext}
            onCopyLink={conversation.onCopyLink}
            onInvite={conversation.onInvite}
            onToggleWorkspace={toggleWorkspace}
            shareDisabled={conversation.id === null}
            workspaceOpen={layout.panel !== null}
          />
        ) : (
          // The CSS covers the moment before hydration knows the width.
          <div className="flex items-center gap-1 max-md:hidden">
            <ShareMenu
              disabled={conversation.id === null}
              lockedContext={lockedContext}
              onCopyLink={conversation.onCopyLink}
              onInvite={conversation.onInvite}
              participants={conversation.participants}
            />
            <WorkspaceToggle
              onToggle={toggleWorkspace}
              open={layout.panel !== null}
            />
          </div>
        )
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
          <ChatTitle
            onRename={conversation.onRename}
            title={conversation.title}
          />
          <BranchSwitcher
            className="shrink-0"
            info={fork}
            onSelect={actions.onSelectBranch ?? noop}
            size="sm"
          />
        </>
      }
      underWindowControls={!layout.sidebarOpen}
    />
  );

  const panel = (
    <RightPanel onClose={closePanel}>
      <LazyWorkspacePanel
        artifacts={workspace.artifacts}
        files={files}
        onSelect={select}
        previewRequest={previewRequest}
        revision={revision}
        selection={shown}
      />
    </RightPanel>
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
      <FilePreviewContext.Provider value={chatWorkspace ? previewFile : null}>
        <Suspense fallback={<div className="flex-1" />}>
          <SeededConversation
            actions={conversationActions}
            conversationKey={conversation.id ?? "new"}
            empty={
              <EmptyState
                onSuggestion={composerDisabled ? undefined : sendSuggestion}
              />
            }
            error={runError}
            feedback={feedback}
            messages={messages}
            pendingApprovals={pendingApprovals}
            seededBranch={seededBranch}
            siblings={siblings}
            streamingMessageId={streamingMessageId}
          />
        </Suspense>
      </FilePreviewContext.Provider>
      <div
        className="mx-auto w-full max-w-2xl shrink-0 px-6 pb-[max(--spacing(4),env(safe-area-inset-bottom))]"
        ref={composerRef}
      >
        <ComposerLoader {...composerProps} />
      </div>
      <ShortcutHelp onOpenChange={setHelpOpen} open={helpOpen} />
      {newFile.asked && files.kind === "chat" ? (
        <Suspense fallback={null}>
          <NewFileDialog
            onCreate={createFile}
            onOpenChange={setNewFileOpen}
            open={newFile.open}
          />
        </Suspense>
      ) : null}
    </AppShell>
  );
}

const noop = () => undefined;

/**
 * The conversation, or while the screen has no messages yet, the branch the
 * server read (ticket 103). The server renders it into the page's HTML as
 * soon as it has it, and hydration renders the same rows, so nothing moves
 * when the query takes over with the same branch.
 */
function SeededConversation({
  messages,
  seededBranch,
  siblings,
  ...props
}: ComponentProps<typeof ConversationView> & {
  readonly seededBranch: SeededBranch | undefined;
}) {
  const seeded =
    seededBranch && messages.length === 0 ? use(seededBranch) : null;
  return (
    <ConversationView
      {...props}
      messages={seeded?.path.messages ?? messages}
      siblings={seeded?.path.siblings ?? siblings}
    />
  );
}

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
