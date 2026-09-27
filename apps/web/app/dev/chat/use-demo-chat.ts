"use client";

import {
  chatArtifacts,
  initialLeafId,
  pendingEdit,
  sidebarChats,
  treeMessages,
} from "@workspace/chat-ui/fixtures";
import {
  localBranchPath,
  newestLeafUnder,
} from "@workspace/chat-ui/model/branch";
import { fixtureId, userAda } from "@workspace/contract/fixtures";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { newId } from "@workspace/shared/ids";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The demo's stand-in for the API and the run stream: chats and messages in
// React state, and answers "streamed" word by word on a timer. Replies are
// sample content, not UI copy, so they stay out of the Lingui catalog.

const WORD_MS = 35;
const WORD = /(\s+)/;

const replyFor = (text: string): string =>
  `No model is connected on this demo page, so this is a canned answer to “${text.slice(0, 80)}”.\n\nIn the app the answer streams from a run, and only this message re-renders while it does. Here's some structure so the markdown renderer has work to do:\n\n- **Rows are memoised** by message id\n- Older messages use \`content-visibility: auto\`\n- Maths loads KaTeX on demand: $$e^{i\\pi} + 1 = 0$$`;

const mainChatId = treeMessages[0]?.conversationId as ConversationId;

const sampleChat = (chat: Conversation): Message[] => {
  const question: Message = {
    agent: null,
    authorId: userAda.id,
    conversationId: chat.id,
    createdAt: chat.createdAt,
    id: fixtureId("message", 900 + Number.parseInt(chat.id.slice(-3), 16)),
    model: null,
    parentId: null,
    parts: [{ text: chat.title ?? "", type: "text" }],
    partsVersion: 1,
    role: "user",
    runId: null,
    status: "complete",
    usage: null,
  };
  return [
    question,
    {
      ...question,
      authorId: null,
      id: fixtureId("message", 1900 + Number.parseInt(chat.id.slice(-3), 16)),
      model: "anthropic:claude-opus-5-5",
      parentId: question.id,
      parts: [{ text: "A short sample answer for this chat.", type: "text" }],
      role: "assistant",
    },
  ];
};

interface Stream {
  readonly messageId: MessageId;
  readonly words: readonly string[];
}

export const useDemoChat = () => {
  const now = useMemo(() => new Date(), []);
  const [chats, setChats] = useState<readonly Conversation[]>(() =>
    sidebarChats(now)
  );
  const [activeId, setActiveId] = useState<ConversationId | null>(mainChatId);
  const [messagesByChat, setMessagesByChat] = useState<
    Readonly<Record<string, readonly Message[]>>
  >(() => ({ [mainChatId]: treeMessages }));
  const [leafByChat, setLeafByChat] = useState<
    Readonly<Record<string, MessageId>>
  >({ [mainChatId]: initialLeafId });
  const [approvals, setApprovals] = useState<readonly PendingApproval[]>([
    pendingEdit,
  ]);
  const [draftContext, setDraftContext] = useState<ChatContext>({
    type: "personal",
  });
  const [stream, setStream] = useState<Stream | null>(null);
  const timer = useRef<number | null>(null);

  const activeChat = chats.find((chat) => chat.id === activeId) ?? null;
  const all =
    activeChat === null
      ? []
      : (messagesByChat[activeChat.id] ?? sampleChat(activeChat));
  const leaf = activeChat
    ? (leafByChat[activeChat.id] ?? all.at(-1)?.id ?? null)
    : null;
  const path = useMemo(() => localBranchPath(all, leaf), [all, leaf]);

  const writeMessages = useCallback(
    (
      chatId: ConversationId,
      update: (messages: readonly Message[]) => readonly Message[]
    ) =>
      setMessagesByChat((current) => {
        const chat = chats.find((item) => item.id === chatId);
        const base = current[chatId] ?? (chat ? sampleChat(chat) : []);
        return { ...current, [chatId]: update(base) };
      }),
    [chats]
  );

  // The mock stream: one word per tick into the streaming message's text.
  useEffect(() => {
    if (!stream) {
      return;
    }
    let index = 0;
    timer.current = window.setInterval(() => {
      index += 1;
      const text = stream.words.slice(0, index).join("");
      setMessagesByChat((current) => {
        const next: Record<string, readonly Message[]> = { ...current };
        for (const [chatId, messages] of Object.entries(current)) {
          if (messages.some((message) => message.id === stream.messageId)) {
            next[chatId] = messages.map((message) =>
              message.id === stream.messageId
                ? { ...message, parts: [{ text, type: "text" }] }
                : message
            );
          }
        }
        return next;
      });
      if (index >= stream.words.length) {
        setStream(null);
      }
    }, WORD_MS);
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
      }
    };
  }, [stream]);

  const answer = useCallback(
    (chatId: ConversationId, parentId: MessageId, question: string) => {
      const reply: Message = {
        agent: null,
        authorId: null,
        conversationId: chatId,
        createdAt: new Date().toISOString(),
        id: newId("message"),
        model: "anthropic:claude-opus-5-5",
        parentId,
        parts: [],
        partsVersion: 1,
        role: "assistant",
        runId: null,
        status: "complete",
        usage: null,
      };
      writeMessages(chatId, (messages) => [...messages, reply]);
      setLeafByChat((current) => ({ ...current, [chatId]: reply.id }));
      setStream({ messageId: reply.id, words: replyFor(question).split(WORD) });
    },
    [writeMessages]
  );

  const ask = useCallback(
    (chatId: ConversationId, parentId: MessageId | null, text: string) => {
      const question: Message = {
        agent: null,
        authorId: userAda.id,
        conversationId: chatId,
        createdAt: new Date().toISOString(),
        id: newId("message"),
        model: null,
        parentId,
        parts: [{ text, type: "text" }],
        partsVersion: 1,
        role: "user",
        runId: null,
        status: "complete",
        usage: null,
      };
      writeMessages(chatId, (messages) => [...messages, question]);
      answer(chatId, question.id, text);
    },
    [answer, writeMessages]
  );

  const send = useCallback(
    (text: string) => {
      if (activeChat) {
        ask(activeChat.id, leaf, text);
        return;
      }
      const at = new Date().toISOString();
      const created: Conversation = {
        ...(chats[0] as Conversation),
        context: draftContext,
        contextLocked: true,
        createdAt: at,
        id: newId("conversation"),
        lastMessageAt: at,
        pinned: false,
        title: text.slice(0, 60),
        updatedAt: at,
      };
      setChats((current) => [created, ...current]);
      setMessagesByChat((current) => ({ ...current, [created.id]: [] }));
      setActiveId(created.id);
      ask(created.id, null, text);
    },
    [activeChat, ask, chats, draftContext, leaf]
  );

  const stop = useCallback(() => setStream(null), []);

  const selectBranch = useCallback(
    (messageId: MessageId) => {
      if (activeChat) {
        setLeafByChat((current) => ({
          ...current,
          [activeChat.id]: newestLeafUnder(all, messageId),
        }));
      }
    },
    [activeChat, all]
  );

  const edit = useCallback(
    (message: Message, text: string) => {
      if (activeChat) {
        ask(activeChat.id, message.parentId, text);
      }
    },
    [activeChat, ask]
  );

  const regenerate = useCallback(
    (message: Message) => {
      const question = all.find((item) => item.id === message.parentId);
      if (activeChat && question) {
        const text = question.parts.flatMap((part) =>
          part.type === "text" ? [part.text] : []
        );
        answer(activeChat.id, question.id, text.join(" "));
      }
    },
    [activeChat, all, answer]
  );

  const decide = useCallback(
    (toolCallId: string, decision: ApprovalDecision) => {
      if (!activeChat) {
        return;
      }
      setApprovals((current) =>
        current.filter((approval) => approval.toolCallId !== toolCallId)
      );
      const decidedAt = new Date().toISOString();
      const approved =
        decision.decision === "approve" ||
        (decision.decision === "review" &&
          decision.hunks.some((hunk) => hunk.decision === "accept"));
      writeMessages(activeChat.id, (messages) =>
        messages.map((message) =>
          message.parts.some(
            (part) =>
              part.type === "tool-call" && part.toolCallId === toolCallId
          )
            ? {
                ...message,
                parts: [
                  ...message.parts.map((part) =>
                    part.type === "tool-call" && part.toolCallId === toolCallId
                      ? {
                          ...part,
                          approval: {
                            decidedAt,
                            decidedBy: userAda.id,
                            decision,
                            state: "decided" as const,
                          },
                        }
                      : part
                  ),
                  {
                    output: approved
                      ? {
                          status: "success" as const,
                          value: "Applied the accepted changes.",
                        }
                      : { decision, status: "denied" as const },
                    toolCallId,
                    toolName: "edit",
                    type: "tool-result" as const,
                  },
                ],
              }
            : message
        )
      );
    },
    [activeChat, writeMessages]
  );

  const setContext = useCallback((context: ChatContext) => {
    setDraftContext(context);
  }, []);

  const newChat = useCallback(() => {
    setActiveId(null);
    setDraftContext({ type: "personal" });
  }, []);

  const updateChat = useCallback(
    (id: ConversationId, change: Partial<Conversation>) =>
      setChats((current) =>
        current.map((chat) => (chat.id === id ? { ...chat, ...change } : chat))
      ),
    []
  );

  return {
    activeChat,
    approvals,
    artifacts: chatArtifacts,
    chats: chats.filter((chat) => !chat.archived),
    decide,
    draftContext,
    edit,
    messages: path?.messages ?? [],
    newChat,
    now,
    regenerate,
    selectBranch,
    selectChat: setActiveId,
    send,
    setContext,
    siblings: path?.siblings ?? [],
    stop,
    streaming: stream?.messageId ?? null,
    updateChat,
  };
};
