"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ApiClient } from "@workspace/client/api";
import { useRunChat } from "@workspace/client/use-run-chat";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { useEffect, useRef, useState } from "react";

import {
  type TestChatComponent,
  TestChatPanel,
  type TestChatProps,
  type TestChatSession,
} from "./test-chat";

// The builder's test chat over real runs (`useRunChat`). The first message
// creates a scratch conversation; "Start over" drops it and begins another.
//
// What it runs: runs take an agent's *published* versions only (the runs
// contract pins published versions), so until drafts can run, the test
// uses the draft's model and parameters directly. That's said on screen.

type RunClient = Pick<ApiClient, "conversations" | "runs">;

/** The run target for testing a draft agent. Pure. */
export const draftTestTarget = (definition: AgentDefinition): RunTarget => ({
  model: definition.model,
  parameters: definition.parameters,
  type: "model",
});

const useRunTestSession = (
  client: RunClient,
  definition: AgentDefinition,
  title: string
): TestChatSession => {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(definition);
  latest.current = definition;
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

  return {
    error,
    messages: chat.messages,
    reset: () => {
      setConversationId(null);
      chat.setMessages([]);
      setError(null);
    },
    send: (text) => {
      setError(null);
      if (conversationId) {
        sendMessage({ text });
        return;
      }
      setQueued(text);
      client.conversations
        .create({ title })
        .then((created) => setConversationId(created.id))
        .catch((cause: Error) => {
          setQueued(null);
          setError(cause.message);
        });
    },
    status: queued ? "submitted" : chat.status,
    stop: () => chat.stop(),
  };
};

/** A test chat component bound to an API client, for `ItemBuilder`'s `testChat`. */
export const createRunTestChat = (client: RunClient): TestChatComponent =>
  function RunTestChat({ definition }: TestChatProps) {
    const { t } = useLingui();
    const session = useRunTestSession(client, definition, t`Agent test`);
    return (
      <TestChatPanel
        definition={definition}
        notice={
          <Trans>
            Runs on the draft's model and settings. Instructions and tools
            aren't part of test runs yet.
          </Trans>
        }
        session={session}
      />
    );
  };
