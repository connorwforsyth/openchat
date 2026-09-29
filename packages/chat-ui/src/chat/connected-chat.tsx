"use client";

import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toUIMessages } from "@workspace/ai/messages/to-ui";
import {
  type ApiClient,
  createQueryUtils,
  type QueryUtils,
} from "@workspace/client/api";
import { useRunChat } from "@workspace/client/use-run-chat";
import { contextOptionsFromMe } from "@workspace/composer/options";
import type {
  AgentOption,
  AttachmentLimits,
  ComposerAttachment,
  ComposerValue,
} from "@workspace/composer/schemas";
import type {
  ConversationId,
  FileId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Me, PublicConfig } from "@workspace/contract/schemas/meta";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type {
  PendingApproval,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import type { FileUIPart, UIMessage } from "ai";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ConversationActions } from "../conversation/actions";
import { newestLeafUnder, type TreeNode } from "../model/branch";
import { mergeLive } from "../model/live-messages";
import type { MemoryUpdate } from "../model/parts";
import type { WorkspaceSelection } from "../model/workspace";
import type { Platform } from "../shell/platform";
import type { ShellLayoutState } from "../shell/use-shell-layout";
import type { Theme } from "../sidebar/account-menu";
import type {
  WorkspaceClient,
  WorkspaceFilesSource,
} from "../workspace/model/client";
import { ChatScreen } from "./chat-screen";
import { useBranchFeedback } from "./use-branch-feedback";
import { useChatQueries, useConversationUpdate } from "./use-chat-data";

// The chat screen over the API (D11): TanStack Query for everything stored,
// `useRunChat` for the turn that's streaming. Ticket 025 mounts this in the
// app (inside a QueryClientProvider); the screen stays presentational.

export interface ConnectedChatProps {
  /** Agents the caller can use, for the composer's picker (`target` and `onTargetChange`). */
  readonly agents?: readonly AgentOption[];
  /**
   * The artifact runtime's origin (`ARTIFACTS_ORIGIN`, D24), normalised with
   * `runtimeOriginFrom`. Omitted or `null`, previews fall back to `srcdoc`.
   */
  readonly artifactsRuntimeOrigin?: string | null;
  readonly brand?: ReactNode;
  readonly client: ApiClient;
  readonly config: PublicConfig;
  /** `null` opens a new, not-yet-created chat. */
  readonly conversationId: ConversationId | null;
  /**
   * The context a new chat starts in. Pass it with `onDraftContextChange` when
   * something outside the screen (the ⌘K palette) can change it too.
   */
  readonly draftContext?: ChatContext;
  /** A new chat sends this once, as soon as it mounts ("Ask AI" in ⌘K). */
  readonly initialPrompt?: string | null;
  /** The shell's layout, when the app owns it (see `ChatScreenProps.layout`). */
  readonly layout?: ShellLayoutState;
  /** Where the library lives (ticket 017). */
  readonly libraryHref?: string;
  readonly me: Me;
  /** The picker's models (`meta.models`); the picker shows with `target` and `onTargetChange`. */
  readonly models?: readonly ModelOption[];
  readonly onDraftContextChange?: (context: ChatContext) => void;
  /** Route to a chat (or `null` for a new one); the app owns the URL. */
  readonly onNavigate: (conversationId: ConversationId | null) => void;
  /** "New organisation" in the account menu. */
  readonly onNewOrg?: () => void;
  /** Shown to the instance admin and to org owners and admins. */
  readonly onOpenAdmin?: () => void;
  readonly onOpenPalette?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onSignOut: () => void;
  readonly onTargetChange?: (target: RunTarget) => void;
  readonly onThemeChange: (theme: Theme) => void;
  readonly platform?: Platform;
  /**
   * The Workspace panel's port over the API, for this chat; `null` for a
   * chat that doesn't exist yet or when sandboxes are off (`config.features`
   * tells the two apart).
   */
  readonly sandboxClient: WorkspaceClient | null;
  /** What answers: a model or an agent. Omitted, the server's default does. */
  readonly target?: RunTarget | null;
  readonly theme: Theme;
}

const fileUrl = (fileId: FileId): string => `/api/files/${fileId}/content`;

const ignore = () => undefined;

const MAX_ATTACHMENTS = 10;
const BYTES_PER_MB = 1024 * 1024;

/** What the composer may attach: nothing when uploads are off (D18 `features`). */
const attachmentLimitsFor = (config: PublicConfig): AttachmentLimits =>
  config.features.fileUploads === false
    ? { maxFiles: 0 }
    : {
        maxFileSize: Math.floor(config.limits.uploadMaxMb * BYTES_PER_MB),
        maxFiles: MAX_ATTACHMENTS,
      };

/**
 * Uploads a turn's attachments through the files API, as the file parts the
 * run transport turns back into stored file references.
 */
const uploadAttachments = (
  client: ApiClient,
  conversationId: ConversationId,
  attachments: readonly ComposerAttachment[]
): Promise<FileUIPart[]> =>
  Promise.all(
    attachments.map(async ({ file }) => {
      const uploaded = await client.files.upload({
        conversationId,
        file,
        purpose: "attachment",
      });
      return {
        filename: uploaded.name,
        mediaType: uploaded.mediaType,
        type: "file" as const,
        url: fileUrl(uploaded.id),
      };
    })
  );

/**
 * The turn being written: `useChat` over runs, seeded with the stored branch
 * (so edits and regenerations know their parent), and the branch as the
 * view shows it, stored path plus live tail.
 */
const useLiveTurn = ({
  client,
  context,
  conversationId,
  me,
  onFinish,
  stored,
  storedAt,
  target,
}: {
  readonly client: ApiClient;
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  readonly me: Me;
  readonly onFinish: () => void;
  readonly stored: readonly Message[];
  /** When the stored branch was last fetched (`dataUpdatedAt`). */
  readonly storedAt: number;
  readonly target: RunTarget | null;
}) => {
  const initialMessages = useMemo(
    () => toUIMessages(stored, { fileUrl }),
    [stored]
  );
  const fieldsRef = useRef({ context, target });
  useEffect(() => {
    fieldsRef.current = { context, target };
  });
  const chat = useRunChat({
    client,
    conversationId: conversationId ?? "new",
    initialMessages,
    onFinish,
    runFields: () => {
      const fields = fieldsRef.current;
      return fields.target
        ? { context: fields.context, target: fields.target }
        : { context: fields.context };
    },
  });
  const { messages: live, setMessages, status } = chat;
  const busy = status === "submitted" || status === "streaming";
  const settling = useSettling({ busy, conversationId, storedAt });

  // Back on the stored branch whenever nothing streams and the branch has
  // caught up: after a switch, a refetch, or the refetch after a turn.
  useEffect(() => {
    if (!(busy || settling)) {
      setMessages(initialMessages);
    }
  }, [busy, initialMessages, setMessages, settling]);

  const last = live.at(-1);
  const lastAnswer = last?.role === "assistant" ? (last.id as MessageId) : null;
  const streamingMessageId = busy ? lastAnswer : null;
  // Until then the finished answer stays as streamed.
  const liveMessageId = busy || settling ? lastAnswer : null;
  const cache = useRef(new WeakMap<UIMessage, Message>());
  const messages = useMemo(
    () =>
      conversationId
        ? mergeLive(
            stored,
            live,
            {
              authorId: me.user.id,
              conversationId,
              now: new Date().toISOString(),
            },
            cache.current,
            liveMessageId
          )
        : stored,
    [conversationId, live, liveMessageId, me.user.id, stored]
  );

  return { chat, messages, streamingMessageId };
};

/** A new chat's context: the caller's when it passes one, else the screen's own. */
const useDraftContext = (
  controlled: ChatContext | undefined,
  onChange: ((context: ChatContext) => void) | undefined
) => {
  const [own, setOwn] = useState<ChatContext>({ type: "personal" });
  const set = useCallback(
    (next: ChatContext) => {
      setOwn(next);
      onChange?.(next);
    },
    [onChange]
  );
  return [controlled ?? own, set] as const;
};

/**
 * "Ask AI" opens a new chat that sends its prompt straight away, once per
 * visit to the new chat.
 */
const useAskOnce = (
  prompt: string | null | undefined,
  conversationId: ConversationId | null,
  submit: (value: ComposerValue) => void
) => {
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId !== null) {
      asked.current = null;
      return;
    }
    if (prompt && asked.current !== prompt) {
      asked.current = prompt;
      submit({ attachments: [], mentions: [], templateId: null, text: prompt });
    }
  }, [conversationId, prompt, submit]);
};

function RunError({
  failed,
  uploadFailed,
}: {
  readonly failed: boolean;
  readonly uploadFailed: boolean;
}) {
  const { t } = useLingui();
  if (!(uploadFailed || failed)) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" role="alert">
      {uploadFailed
        ? t`The message couldn't be sent: an attachment didn't upload. Try again.`
        : t`The answer failed. Try again, or regenerate it.`}
    </p>
  );
}

/** Tool calls on screen that wait for a decision. Pure. */
const pendingCallIds = (messages: readonly Message[]): string =>
  messages
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-call" && part.approval.state === "pending"
          ? [part.toolCallId]
          : []
      )
    )
    .join(" ");

/**
 * A reply that pauses for approval does so mid-stream, and the stream
 * doesn't carry the run's pending approvals: the proposed edits a reviewer
 * decides hunk by hunk (D16) are on the run. So a call waiting on screen
 * that the fetched run doesn't list yet fetches it again (040's e2e: the
 * card offered only approve/reject until a reload).
 */
const useApprovalsInSync = ({
  approvals,
  messages,
  onMissing,
}: {
  readonly approvals: readonly PendingApproval[] | undefined;
  readonly messages: readonly Message[];
  readonly onMissing: () => void;
}) => {
  const pending = pendingCallIds(messages);
  const known = new Set(approvals?.map((approval) => approval.toolCallId));
  const missing =
    pending !== "" && pending.split(" ").some((id) => !known.has(id));
  // The call can reach the screen a moment before the run records the pause,
  // so a fetch that still finds it running tries again, a few times.
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!missing || attempts >= APPROVAL_SYNC_ATTEMPTS) {
      return;
    }
    const timer = setTimeout(
      () => {
        onMissing();
        setAttempts((count) => count + 1);
      },
      attempts === 0 ? 0 : APPROVAL_SYNC_RETRY_MS
    );
    return () => clearTimeout(timer);
  }, [attempts, missing, onMissing]);
  useEffect(() => {
    if (!missing) {
      setAttempts(0);
    }
  }, [missing]);
};

const APPROVAL_SYNC_ATTEMPTS = 10;
const APPROVAL_SYNC_RETRY_MS = 500;

/**
 * Whether a turn just finished and the stored branch hasn't been fetched
 * since. The run stores its answer before the stream ends, but the branch
 * on screen is the one fetched when the turn started (040's e2e: showing it
 * flashed "This answer stopped early" at the end of every reply). So the
 * streamed answer stays until the refetch the finish triggers lands.
 */
const useSettling = ({
  busy,
  conversationId,
  storedAt,
}: {
  readonly busy: boolean;
  readonly conversationId: ConversationId | null;
  readonly storedAt: number;
}): boolean => {
  const [seen, setSeen] = useState({ busy, conversationId });
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  // Derived during render (React's "adjusting state on a prop change"), so
  // the render where the turn ends already knows it's settling.
  if (seen.busy !== busy || seen.conversationId !== conversationId) {
    setSeen({ busy, conversationId });
    setFinishedAt(
      seen.busy && !busy && seen.conversationId === conversationId
        ? storedAt
        : null
    );
  }
  return finishedAt !== null && storedAt <= finishedAt;
};

/**
 * A chat opened while a reply is still being written (the tab was closed or
 * reloaded mid-reply, PLAN.md §11 M1 step 3) follows that run's stream.
 * Checked once per opened chat, when its active runs first load: a run this
 * page started itself is already being followed (the chat isn't idle).
 */
const useFollowRunningReply = ({
  conversationId,
  resumeStream,
  runningRunId,
  status,
}: {
  readonly conversationId: ConversationId | null;
  readonly resumeStream: () => Promise<void>;
  readonly runningRunId: string | null | undefined;
  readonly status: "submitted" | "streaming" | "ready" | "error";
}) => {
  const idle = status === "ready" || status === "error";
  const checked = useRef<ConversationId | null>(null);
  useEffect(() => {
    if (
      !conversationId ||
      runningRunId === undefined ||
      checked.current === conversationId
    ) {
      return;
    }
    checked.current = conversationId;
    if (runningRunId && idle) {
      resumeStream().catch(ignore);
    }
  }, [conversationId, idle, resumeStream, runningRunId]);
};

/** A new chat is created on first send; the send happens once it's routed to. */
const useFirstSend = ({
  api,
  client,
  context,
  conversationId,
  onNavigate,
  send,
  target,
}: {
  readonly api: QueryUtils;
  readonly client: ApiClient;
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  readonly onNavigate: (id: ConversationId) => void;
  readonly send: (text: string, files: FileUIPart[]) => void;
  /** Stored as the new chat's default, so reopening it continues with the same agent or model. */
  readonly target: RunTarget | null;
}) => {
  const [pending, setPending] = useState<{
    readonly conversationId: ConversationId;
    readonly files: FileUIPart[];
    readonly text: string;
  } | null>(null);
  useEffect(() => {
    if (pending && pending.conversationId === conversationId) {
      setPending(null);
      send(pending.text, pending.files);
    }
  }, [conversationId, pending, send]);

  const { mutateAsync: create } = useMutation(
    api.conversations.create.mutationOptions()
  );
  return useCallback(
    async (value: ComposerValue) => {
      // Files belong to a conversation, so a new chat exists before they
      // upload; the message goes once they have.
      const id =
        conversationId ??
        (await create({ context, defaultTarget: target ?? undefined })).id;
      const files = await uploadAttachments(client, id, value.attachments);
      if (conversationId) {
        send(value.text, files);
        return;
      }
      setPending({ conversationId: id, files, text: value.text });
      onNavigate(id);
    },
    [client, context, conversationId, create, onNavigate, send, target]
  );
};

const TITLE_WAIT_MS = 30_000;

/**
 * Live titles (044). The title job runs once a chat's first turn has ended,
 * after its stream has closed, so a turn that ends in an untitled chat
 * watches the chat for a short while: `watching` makes the chat's query
 * poll until the title is there (`useChatQueries`).
 */
const useTitleWatch = (conversationId: ConversationId | null) => {
  const [watch, setWatch] = useState<{
    readonly id: ConversationId;
    readonly until: number;
  } | null>(null);
  const watching = watch !== null && watch.id === conversationId;
  const until = watching ? watch.until : null;
  useEffect(() => {
    if (until === null) {
      return;
    }
    const timer = setTimeout(
      () => setWatch(null),
      Math.max(0, until - Date.now())
    );
    return () => clearTimeout(timer);
  }, [until]);
  const start = useCallback(() => {
    if (conversationId) {
      setWatch({ id: conversationId, until: Date.now() + TITLE_WAIT_MS });
    }
  }, [conversationId]);
  return { start, watching };
};

/** A chat's title as fetched, copied into the cached chat lists (the sidebar). */
const useTitleInLists = (
  api: QueryUtils,
  conversationId: ConversationId | null,
  title: string | null | undefined
) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!(conversationId && title)) {
      return;
    }
    queryClient.setQueriesData<ConversationPage>(
      { queryKey: api.conversations.list.key() },
      (page) =>
        page?.items.some(
          (item) => item.id === conversationId && item.title !== title
        )
          ? {
              ...page,
              items: page.items.map((item) =>
                item.id === conversationId ? { ...item, title } : item
              ),
            }
          : page
    );
  }, [api, conversationId, queryClient, title]);
};

interface ConversationPage {
  readonly items: readonly Conversation[];
  readonly nextCursor: string | null;
}

export function ConnectedChat({
  agents,
  artifactsRuntimeOrigin = null,
  brand,
  client,
  config,
  conversationId,
  draftContext: draftContextProp,
  initialPrompt,
  layout,
  libraryHref,
  me,
  models,
  onDraftContextChange,
  onNavigate,
  onNewOrg,
  onOpenAdmin,
  onOpenPalette,
  onOpenSettings,
  onSignOut,
  onTargetChange,
  onThemeChange,
  platform,
  sandboxClient,
  target = null,
  theme,
}: ConnectedChatProps) {
  const { t } = useLingui();
  const api = useMemo(() => createQueryUtils(client), [client]);
  const queryClient = useQueryClient();
  const [leafId, setLeafId] = useState<MessageId | undefined>();
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [draftContext, setDraftContext] = useDraftContext(
    draftContextProp,
    onDraftContextChange
  );
  const [uploadFailed, setUploadFailed] = useState(false);
  const titleWatch = useTitleWatch(conversationId);

  const data = useChatQueries(api, {
    artifactId:
      selection?.kind === "artifact" ? (selection.artifactId ?? null) : null,
    conversationId,
    leafId,
    sandboxes: config.features.sandboxes,
    watchTitle: titleWatch.watching,
  });
  const storedTitle = data.conversation.data?.title;
  useTitleInLists(api, conversationId, storedTitle);
  const titleRef = useRef(storedTitle);
  titleRef.current = storedTitle;
  const stored = data.path.data?.messages ?? NO_MESSAGES;
  const feedback = useBranchFeedback(api, stored);
  const update = useConversationUpdate(api);

  // Another chat starts from its own active leaf and artifacts.
  const [shownId, setShownId] = useState(conversationId);
  if (shownId !== conversationId) {
    setShownId(conversationId);
    setLeafId(undefined);
    setSelection(null);
    feedback.reset();
  }

  const refresh = useCallback(() => {
    for (const key of [
      api.messages.key(),
      api.runs.key(),
      api.conversations.key(),
      api.artifacts.key(),
      // The agent may have created a sandbox or exposed a preview this turn.
      api.sandbox.key(),
    ]) {
      queryClient.invalidateQueries({ queryKey: key }).catch(ignore);
    }
  }, [api, queryClient]);

  // Every change the Workspace panel makes goes back through `sandbox.get`,
  // so the panel and everything else read one record (060).
  const onWorkspaceChanged = useCallback(() => {
    queryClient
      .invalidateQueries({ queryKey: api.sandbox.key() })
      .catch(ignore);
  }, [api, queryClient]);
  const sandboxRecord = data.sandbox.data ?? null;
  const workspaceFiles = useMemo((): WorkspaceFilesSource => {
    if (!config.features.sandboxes) {
      return { kind: "off" };
    }
    if (!(conversationId && sandboxClient)) {
      return { kind: "new-chat" };
    }
    return {
      client: sandboxClient,
      kind: "chat",
      onChanged: onWorkspaceChanged,
      sandbox: sandboxRecord,
    };
  }, [
    config.features.sandboxes,
    conversationId,
    onWorkspaceChanged,
    sandboxClient,
    sandboxRecord,
  ]);

  const context = data.conversation.data?.context ?? draftContext;
  const { start: watchTitle } = titleWatch;
  const onFinish = useCallback(() => {
    refresh();
    if (titleRef.current === null) {
      watchTitle();
    }
  }, [refresh, watchTitle]);
  const { chat, messages, streamingMessageId } = useLiveTurn({
    client,
    context,
    conversationId,
    me,
    onFinish,
    stored,
    storedAt: data.path.dataUpdatedAt,
    target,
  });
  const { regenerate, resumeStream, sendMessage, setMessages } = chat;
  useFollowRunningReply({
    conversationId,
    resumeStream,
    runningRunId: data.runningRunId,
    status: chat.status,
  });
  const send = useCallback(
    (text: string, files: FileUIPart[] = []) => {
      sendMessage(files.length > 0 ? { files, text } : { text }).catch(ignore);
    },
    [sendMessage]
  );
  const submit = useFirstSend({
    api,
    client,
    context: draftContext,
    conversationId,
    onNavigate,
    send,
    target,
  });

  const { mutate: decide } = useMutation(
    api.runs.submitApprovals.mutationOptions()
  );
  const { mutateAsync: revertMemory } = useMutation(
    api.memory.revert.mutationOptions()
  );
  const { mutateAsync: replaceMemory } = useMutation(
    api.memory.update.mutationOptions()
  );
  const { mutate: rememberLeaf } = useMutation(
    api.conversations.updateMyState.mutationOptions()
  );
  const { mutate: changeContext } = useMutation(
    api.conversations.setContext.mutationOptions({ onSettled: refresh })
  );

  const runId = data.activeRun?.id;
  const nodes: readonly TreeNode[] = data.tree.data?.nodes ?? stored;
  const actions = useMemo(
    (): ConversationActions => ({
      fileUrl,
      onClearFeedback: feedback.clear,
      onDecide: (toolCallId, decision) => {
        if (!runId) {
          return;
        }
        decide(
          { decisions: [{ decision, toolCallId }], runId },
          {
            onSettled: () => {
              refresh();
              // The run carries on server-side; follow its stream again.
              resumeStream().catch(ignore);
            },
          }
        );
      },
      onEdit: (message, text) => {
        // An edit answers the same parent: send it from that point.
        const at = stored.findIndex((item) => item.id === message.id);
        setMessages(toUIMessages(stored.slice(0, at), { fileUrl }));
        send(text);
      },
      onFeedback: feedback.set,
      onRegenerate: (message) => {
        const at = stored.findIndex((item) => item.id === message.id);
        setMessages(toUIMessages(stored.slice(0, at + 1), { fileUrl }));
        regenerate({ messageId: message.id }).catch(ignore);
      },
      onSelectBranch: (messageId) => {
        const leaf = newestLeafUnder(nodes, messageId);
        setLeafId(leaf);
        if (conversationId) {
          rememberLeaf({ activeLeafId: leaf, conversationId });
        }
      },
      onUndoMemory: async (memory: MemoryUpdate) => {
        // D20, ticket 022: back to the previous version, or clear a first
        // write (based on the version it made).
        await (memory.previousVersionId
          ? revertMemory({ versionId: memory.previousVersionId })
          : replaceMemory({ baseVersionId: memory.versionId, content: "" }));
      },
    }),
    [
      conversationId,
      decide,
      feedback.clear,
      feedback.set,
      nodes,
      refresh,
      regenerate,
      rememberLeaf,
      replaceMemory,
      resumeStream,
      revertMemory,
      runId,
      send,
      setMessages,
      stored,
    ]
  );

  const contextOptions = useMemo(
    () => contextOptionsFromMe(me, config.policies.chatContexts),
    [config.policies.chatContexts, me]
  );
  const onContextChange = useCallback(
    (next: ChatContext) => {
      if (conversationId) {
        changeContext({ context: next, id: conversationId });
      } else {
        setDraftContext(next);
      }
    },
    [changeContext, conversationId, setDraftContext]
  );
  const onRename = useCallback(
    (title: string) => {
      if (conversationId) {
        update({ id: conversationId, title });
      }
    },
    [conversationId, update]
  );
  const copyLink = useCallback(async () => {
    await navigator.clipboard?.writeText(window.location.href);
  }, []);
  const onSubmit = useCallback(
    (value: ComposerValue) => {
      setUploadFailed(false);
      submit(value).catch(() => setUploadFailed(true));
    },
    [submit]
  );

  useAskOnce(initialPrompt, conversationId, onSubmit);
  const attachmentLimits = useMemo(() => attachmentLimitsFor(config), [config]);
  const newChat = useCallback(() => onNavigate(null), [onNavigate]);
  const sidebarActions = useMemo(
    () => ({
      onArchive: (id: ConversationId) => update({ archived: true, id }),
      onRename: (id: ConversationId, title: string) => update({ id, title }),
      onRestore: (id: ConversationId) => update({ archived: false, id }),
      onTogglePin: (id: ConversationId, pinned: boolean) =>
        update({ id, pinned }),
    }),
    [update]
  );

  const approvals =
    data.activeRun?.state.status === "awaiting_approval"
      ? data.activeRun.state.approvals
      : undefined;
  useApprovalsInSync({ approvals, messages, onMissing: refresh });
  const current = data.conversation.data;

  return (
    <ChatScreen
      actions={actions}
      brand={brand}
      composer={{
        agents,
        attachmentLimits,
        models,
        onStop: chat.stop,
        onSubmit,
        onTargetChange,
        status: chat.status,
        target: target ?? undefined,
      }}
      conversation={{
        context,
        contextLocked: current?.contextLocked ?? false,
        contextOptions,
        id: conversationId,
        onContextChange,
        onCopyLink: copyLink,
        onRename: conversationId ? onRename : undefined,
        participants: data.participants.data ?? [],
        title: current?.title ?? null,
      }}
      feedback={feedback.byMessage}
      layout={layout}
      messages={messages}
      onNewChat={newChat}
      onOpenPalette={onOpenPalette}
      pendingApprovals={approvals}
      platform={platform}
      runError={
        <RunError failed={Boolean(chat.error)} uploadFailed={uploadFailed} />
      }
      siblings={data.path.data?.siblings ?? []}
      sidebar={{
        ...sidebarActions,
        account: {
          onNewOrg,
          onOpenAdmin,
          onOpenSettings,
          onSignOut,
          onThemeChange,
          theme,
          user: me.user,
        },
        activeId: conversationId,
        chats: data.chats.data?.items ?? [],
        libraryHref,
        onSelect: onNavigate,
      }}
      streamingMessageId={streamingMessageId}
      workspace={{
        artifacts: {
          artifacts: data.artifacts.data ?? [],
          error: data.versions.isError ? t`Couldn't load this artifact.` : null,
          runtimeOrigin: artifactsRuntimeOrigin,
          versions: data.versions.data,
        },
        files: workspaceFiles,
        onSelect: setSelection,
        selection,
      }}
    />
  );
}

const NO_MESSAGES: readonly Message[] = [];
