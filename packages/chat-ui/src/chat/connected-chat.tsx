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
import type { ComposerValue } from "@workspace/composer/schemas";
import type {
  ConversationId,
  FileId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Me, PublicConfig } from "@workspace/contract/schemas/meta";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import type { UIMessage } from "ai";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ArtifactSelection } from "../artifacts/artifacts-panel";
import type { ConversationActions } from "../conversation/actions";
import { newestLeafUnder, type TreeNode } from "../model/branch";
import { mergeLive } from "../model/live-messages";
import type { MemoryUpdate } from "../model/parts";
import type { SandboxPanelClient } from "../sandbox/model/client";
import type { Platform } from "../shell/platform";
import type { Theme } from "../sidebar/account-menu";
import { ChatScreen } from "./chat-screen";
import {
  useChatQueries,
  useConversationUpdate,
  useFeedback,
} from "./use-chat-data";

// The chat screen over the API (D11): TanStack Query for everything stored,
// `useRunChat` for the turn that's streaming. Ticket 025 mounts this in the
// app (inside a QueryClientProvider); the screen stays presentational.

export interface ConnectedChatProps {
  readonly brand?: ReactNode;
  readonly client: ApiClient;
  readonly config: PublicConfig;
  /** `null` opens a new, not-yet-created chat. */
  readonly conversationId: ConversationId | null;
  /** Where the library lives (ticket 017). */
  readonly libraryHref?: string;
  readonly me: Me;
  /** Route to a chat (or `null` for a new one); the app owns the URL. */
  readonly onNavigate: (conversationId: ConversationId | null) => void;
  readonly onOpenAdmin?: () => void;
  readonly onOpenPalette?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onSignOut: () => void;
  readonly onThemeChange: (theme: Theme) => void;
  readonly platform?: Platform;
  /** The sandbox panel's port over the API; `null` hides the panel. */
  readonly sandboxClient: SandboxPanelClient | null;
  readonly theme: Theme;
}

const fileUrl = (fileId: FileId): string => `/api/files/${fileId}/content`;

const ignore = () => undefined;

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
}: {
  readonly client: ApiClient;
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  readonly me: Me;
  readonly onFinish: () => void;
  readonly stored: readonly Message[];
}) => {
  const initialMessages = useMemo(
    () => toUIMessages(stored, { fileUrl }),
    [stored]
  );
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });
  const chat = useRunChat({
    client,
    conversationId: conversationId ?? "new",
    initialMessages,
    onFinish,
    runFields: () => ({ context: contextRef.current }),
  });
  const { messages: live, setMessages, status } = chat;
  const busy = status === "submitted" || status === "streaming";

  // Back on the stored branch whenever nothing streams: after a switch, a
  // refetch or a finished turn.
  useEffect(() => {
    if (!busy) {
      setMessages(initialMessages);
    }
  }, [busy, initialMessages, setMessages]);

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
            cache.current
          )
        : stored,
    [conversationId, live, me.user.id, stored]
  );
  const last = live.at(-1);
  const streamingMessageId =
    busy && last?.role === "assistant" ? (last.id as MessageId) : null;

  return { chat, messages, streamingMessageId };
};

/** A new chat is created on first send; the send happens once it's routed to. */
const useFirstSend = ({
  api,
  context,
  conversationId,
  onNavigate,
  send,
}: {
  readonly api: QueryUtils;
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  readonly onNavigate: (id: ConversationId) => void;
  readonly send: (text: string) => void;
}) => {
  const [pending, setPending] = useState<{
    readonly conversationId: ConversationId;
    readonly text: string;
  } | null>(null);
  useEffect(() => {
    if (pending && pending.conversationId === conversationId) {
      setPending(null);
      send(pending.text);
    }
  }, [conversationId, pending, send]);

  const { mutateAsync: create } = useMutation(
    api.conversations.create.mutationOptions()
  );
  return useCallback(
    async (value: ComposerValue) => {
      // TODO(025): upload `value.attachments` through the files API and send
      // them as file parts; the composer already hands over the `File`s.
      if (conversationId) {
        send(value.text);
        return;
      }
      const created = await create({ context });
      setPending({ conversationId: created.id, text: value.text });
      onNavigate(created.id);
    },
    [context, conversationId, create, onNavigate, send]
  );
};

export function ConnectedChat({
  brand,
  client,
  config,
  conversationId,
  libraryHref,
  me,
  onNavigate,
  onOpenAdmin,
  onOpenPalette,
  onOpenSettings,
  onSignOut,
  onThemeChange,
  platform,
  sandboxClient,
  theme,
}: ConnectedChatProps) {
  const { t } = useLingui();
  const api = useMemo(() => createQueryUtils(client), [client]);
  const queryClient = useQueryClient();
  const [leafId, setLeafId] = useState<MessageId | undefined>();
  const [selection, setSelection] = useState<ArtifactSelection | null>(null);
  const [draftContext, setDraftContext] = useState<ChatContext>({
    type: "personal",
  });

  const data = useChatQueries(api, {
    artifactId: selection?.artifactId ?? null,
    conversationId,
    leafId,
    sandboxes: config.features.sandboxes,
  });
  const stored = data.path.data?.messages ?? NO_MESSAGES;
  const feedback = useFeedback(api, stored);
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
    ]) {
      queryClient.invalidateQueries({ queryKey: key }).catch(ignore);
    }
  }, [api, queryClient]);

  const context = data.conversation.data?.context ?? draftContext;
  const { chat, messages, streamingMessageId } = useLiveTurn({
    client,
    context,
    conversationId,
    me,
    onFinish: refresh,
    stored,
  });
  const { regenerate, resumeStream, sendMessage, setMessages } = chat;
  const send = useCallback(
    (text: string) => {
      sendMessage({ text }).catch(ignore);
    },
    [sendMessage]
  );
  const submit = useFirstSend({
    api,
    context: draftContext,
    conversationId,
    onNavigate,
    send,
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
    [changeContext, conversationId]
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
      submit(value).catch(ignore);
    },
    [submit]
  );
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
  const current = data.conversation.data;

  return (
    <ChatScreen
      actions={actions}
      artifacts={{
        artifacts: data.artifacts.data ?? [],
        error: data.versions.isError ? t`Couldn't load this artifact.` : null,
        onSelect: setSelection,
        selection: data.selectedArtifactId
          ? { ...selection, artifactId: data.selectedArtifactId }
          : null,
        versions: data.versions.data,
      }}
      brand={brand}
      composer={{
        onStop: chat.stop,
        onSubmit,
        status: chat.status,
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
      messages={messages}
      onNewChat={newChat}
      onOpenPalette={onOpenPalette}
      pendingApprovals={approvals}
      platform={platform}
      runError={
        chat.error ? (
          <p className="text-destructive text-sm" role="alert">
            {t`The answer failed. Try again, or regenerate it.`}
          </p>
        ) : null
      }
      sandbox={
        sandboxClient && config.features.sandboxes
          ? { client: sandboxClient, initial: data.sandbox.data ?? null }
          : null
      }
      siblings={data.path.data?.siblings ?? []}
      sidebar={{
        ...sidebarActions,
        account: {
          onOpenAdmin: me.user.isAdmin ? onOpenAdmin : undefined,
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
    />
  );
}

const NO_MESSAGES: readonly Message[] = [];
