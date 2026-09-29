"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ChatScreen } from "@workspace/chat-ui/chat/chat-screen";
import type {
  ConversationActions,
  FeedbackInput,
} from "@workspace/chat-ui/conversation/actions";
import type { MessageFeedback } from "@workspace/chat-ui/conversation/feedback";
import {
  artifactVersions,
  chatContext,
  chatMe,
  participants,
} from "@workspace/chat-ui/fixtures";
import type { WorkspaceSelection } from "@workspace/chat-ui/model/workspace";
import {
  type Theme,
  themeSchema,
} from "@workspace/chat-ui/sidebar/account-menu";
import { contextOptionsFromMe } from "@workspace/composer/options";
import type { ComposerValue } from "@workspace/composer/schemas";
import { publicConfig } from "@workspace/contract/fixtures";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createDemoWorkspace } from "../sandbox/demo";
import { demoArtifactVersions } from "./demo-artifacts";
import { useDemoChat } from "./use-demo-chat";

// The whole chat shell over contract fixtures and a mock stream, for trying
// the layout, shortcuts and message parts without a server or a model.

const contextOptions = contextOptionsFromMe(
  chatMe,
  publicConfig.policies.chatContexts
);

const MEMORY_UNDO_MS = 400;

export function ChatDemo({
  artifactsOrigin,
}: {
  /** The artifact runtime (`ARTIFACTS_ORIGIN`); `null` falls back to `srcdoc`. */
  readonly artifactsOrigin: string | null;
}) {
  const { t } = useLingui();
  const demo = useDemoChat();
  const { setTheme, theme } = useTheme();
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [feedback, setFeedback] = useState<Record<string, MessageFeedback>>({});
  const selectedId =
    (selection?.kind === "artifact" ? selection.artifactId : undefined) ??
    demo.artifacts[0]?.id;
  // The Workspace panel's files: a just-bash workspace in this tab.
  const workspace = useMemo(
    () => createDemoWorkspace(() => t`The demo workspace couldn't do that.`),
    [t]
  );
  const [record, setRecord] = useState<SandboxRecord | null>(null);
  useEffect(() => setRecord(workspace.record()), [workspace]);
  const onWorkspaceChanged = useCallback(
    () => setRecord(workspace.record()),
    [workspace]
  );

  const actions = useMemo(
    (): ConversationActions => ({
      onClearFeedback: (messageId: MessageId) =>
        setFeedback((current) => {
          const { [messageId]: _removed, ...rest } = current;
          return rest;
        }),
      onDecide: demo.decide,
      onEdit: demo.edit,
      onFeedback: (input: FeedbackInput) =>
        setFeedback((current) => ({
          ...current,
          [input.messageId]: {
            comment: input.comment ?? null,
            rating: input.rating,
            shareWithMaintainers: input.shareWithMaintainers ?? false,
          },
        })),
      onRegenerate: demo.regenerate,
      onSelectBranch: demo.selectBranch,
      onUndoMemory: () =>
        new Promise((resolve) => window.setTimeout(resolve, MEMORY_UNDO_MS)),
    }),
    [demo.decide, demo.edit, demo.regenerate, demo.selectBranch]
  );

  const onSubmit = useCallback(
    (value: ComposerValue) => demo.send(value.text),
    [demo]
  );
  const onThemeChange = useCallback(
    (next: Theme) => setTheme(next),
    [setTheme]
  );
  const copyLink = useCallback(async () => {
    await navigator.clipboard?.writeText(window.location.href);
  }, []);

  const chat = demo.activeChat;
  const parsedTheme = themeSchema.safeParse(theme);

  return (
    <ChatScreen
      actions={actions}
      brand={
        <span className="truncate font-medium text-sm">
          <Trans>Chat demo</Trans>
        </span>
      }
      composer={{
        onStop: demo.stop,
        onSubmit,
        placeholder: t`Ask anything`,
        status: demo.streaming ? "streaming" : "ready",
      }}
      conversation={{
        context: chat?.context ?? demo.draftContext,
        contextLocked: chat !== null,
        contextOptions,
        id: chat?.id ?? null,
        onContextChange: demo.setContext,
        onCopyLink: copyLink,
        onRename: chat
          ? (title) => demo.updateChat(chat.id, { title })
          : undefined,
        participants:
          chat?.context.type === chatContext.type ? participants : [],
        title: chat?.title ?? null,
      }}
      feedback={feedback}
      messages={demo.messages}
      onNewChat={demo.newChat}
      pendingApprovals={demo.approvals}
      siblings={demo.siblings}
      sidebar={{
        account: {
          onOpenAdmin: () => undefined,
          onOpenSettings: () => undefined,
          onSignOut: () => undefined,
          onThemeChange,
          theme: parsedTheme.success ? parsedTheme.data : "system",
          user: chatMe.user,
        },
        activeId: chat?.id ?? null,
        chats: demo.chats,
        libraryHref: "#library",
        now: demo.now,
        onArchive: (id) => demo.updateChat(id, { archived: true }),
        onRename: (id, title) => demo.updateChat(id, { title }),
        onRestore: (id) => demo.updateChat(id, { archived: false }),
        onSelect: demo.selectChat,
        onTogglePin: (id, pinned) => demo.updateChat(id, { pinned }),
      }}
      streamingMessageId={demo.streaming}
      workspace={{
        artifacts: {
          artifacts: demo.artifacts,
          runtimeOrigin: artifactsOrigin,
          versions: selectedId
            ? (artifactVersions[selectedId] ??
              demoArtifactVersions[selectedId] ??
              [])
            : [],
        },
        files: {
          client: workspace.client,
          kind: "chat",
          onChanged: onWorkspaceChanged,
          sandbox: record,
        },
        onSelect: setSelection,
        selection,
      }}
    />
  );
}
