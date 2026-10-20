"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ApiClient } from "@workspace/client/api";
import { useRunChat } from "@workspace/client/use-run-chat";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { Badge } from "@workspace/ui/components/badge";
import { useEffect, useRef, useState } from "react";

import { KindTile } from "./kind";

import {
  type TestChatComponent,
  type TestChatDraft,
  TestChatPanel,
  type TestChatProps,
  type TestChatSession,
} from "./test-chat";

// The builder's test chat over real runs (`useRunChat`), answering with the
// agent's stored *draft*: its instructions, tools and knowledge, not just
// its model (033). Runs may pin the draft's version id for anyone who can
// edit the agent. Sending saves unsaved edits first, so every answer
// reflects the form as it is.
//
// The first message creates a scratch conversation whose default target
// is the draft; the server treats that as a test chat, keeps it out of the
// history and search, and deletes it after a day. "Start over" drops it at
// once and begins another.

type RunClient = Pick<ApiClient, "conversations" | "runs">;

/** The run target for testing an agent's draft. Pure. */
export const draftTestTarget = (draft: TestChatDraft): RunTarget => ({
  id: draft.itemId,
  type: "agent",
  versionId: draft.versionId,
});

const useRunTestSession = (
  client: RunClient,
  draft: TestChatDraft,
  options: {
    readonly beforeSend?: () => Promise<boolean>;
    readonly title: string;
    readonly unsaved: string;
  }
): TestChatSession => {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Publishing opens a fresh draft with a new id; each run takes the
  // current one.
  const latest = useRef(draft);
  latest.current = draft;
  const chat = useRunChat({
    client,
    // `useChat` needs an id before the conversation exists; the first send
    // creates it and the queued text follows.
    conversationId: conversationId ?? "pending",
    onError: (cause) => setError(cause.message),
    runFields: () => ({ target: draftTestTarget(latest.current) }),
  });
  const { sendMessage } = chat;

  useEffect(() => {
    if (conversationId && queued) {
      setQueued(null);
      sendMessage({ text: queued });
    }
  }, [conversationId, queued, sendMessage]);

  const start = (text: string) => {
    if (conversationId) {
      sendMessage({ text });
      return;
    }
    setQueued(text);
    client.conversations
      .create({
        defaultTarget: draftTestTarget(latest.current),
        title: options.title,
      })
      .then((created) => setConversationId(created.id))
      .catch((cause: Error) => {
        setQueued(null);
        setError(cause.message);
      });
  };

  return {
    error,
    messages: chat.messages,
    reset: () => {
      if (conversationId) {
        // Nobody can reach it again; the cleanup job would get it later.
        client.conversations
          .delete({ id: conversationId })
          .catch(() => undefined);
      }
      setConversationId(null);
      chat.setMessages([]);
      setError(null);
    },
    send: (text) => {
      setError(null);
      const { beforeSend } = options;
      if (!beforeSend) {
        start(text);
        return;
      }
      setPreparing(true);
      beforeSend()
        .then((saved) => (saved ? start(text) : setError(options.unsaved)))
        .catch(() => setError(options.unsaved))
        .finally(() => setPreparing(false));
    },
    status: preparing || queued ? "submitted" : chat.status,
    stop: () => chat.stop(),
  };
};

function DraftTestChat({
  beforeSend,
  client,
  definition,
  dirty,
  draft,
  identity,
}: Omit<TestChatProps, "draft"> & {
  readonly client: RunClient;
  readonly draft: TestChatDraft;
}) {
  const { t } = useLingui();
  const session = useRunTestSession(client, draft, {
    beforeSend,
    title: t`Agent test`,
    unsaved: t`Your changes couldn't be saved, so the message wasn't sent.`,
  });
  return (
    <TestChatPanel
      badge={
        <Badge variant="secondary">
          <Trans>Testing draft</Trans>
        </Badge>
      }
      definition={definition}
      identity={identity}
      notice={
        dirty ? (
          <Trans>
            Sending a message saves your changes to the draft first.
          </Trans>
        ) : undefined
      }
      session={session}
    />
  );
}

/** A test chat component bound to an API client, for `ItemBuilder`'s `testChat`. */
export const createRunTestChat = (client: RunClient): TestChatComponent =>
  function RunTestChat({ draft, ...props }: TestChatProps) {
    if (!draft) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <KindTile
            className="size-14 rounded-xl [&_svg]:size-6"
            kind="agent"
          />
          {props.identity?.name ? (
            <p className="font-medium text-lg">{props.identity.name}</p>
          ) : null}
          <p className="max-w-xs text-pretty text-muted-foreground text-sm">
            <Trans>Create the agent to try it in a test chat.</Trans>
          </p>
        </div>
      );
    }
    // Keyed by item so opening another agent starts a fresh chat.
    return (
      <DraftTestChat
        {...props}
        client={client}
        draft={draft}
        key={draft.itemId}
      />
    );
  };
