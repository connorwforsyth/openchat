"use client";

import { Trans } from "@lingui/react/macro";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

import {
  TestChatPanel,
  type TestChatProps,
  type TestChatSession,
} from "../components/test-chat";

// A test chat that answers from the draft itself, for the `/dev/library`
// demo and component tests: no model, no network. The reply quotes the
// instructions so you can see edits reach the chat before they're saved.

const REPLY_DELAY_MS = 400;

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  return `${prefix}-${counter}`;
};

const textMessage = (role: UIMessage["role"], text: string): UIMessage => ({
  id: nextId(role),
  parts: [{ text, type: "text" }],
  role,
});

const useEchoSession = (instructions: string): TestChatSession => {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(instructions);
  latest.current = instructions;
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    error: null,
    messages,
    reset: () => setMessages([]),
    send: (text) => {
      setMessages((current) => [...current, textMessage("user", text)]);
      setBusy(true);
      timer.current = setTimeout(() => {
        const brief = latest.current.trim().split("\n")[0] ?? "";
        setMessages((current) => [
          ...current,
          textMessage("assistant", brief ? `> ${brief}\n\n${text}` : text),
        ]);
        setBusy(false);
      }, REPLY_DELAY_MS);
    },
    status: busy ? "streaming" : "ready",
    stop: () => {
      clearTimeout(timer.current);
      setBusy(false);
    },
  };
};

export function EchoTestChat({ definition, dirty, identity }: TestChatProps) {
  const session = useEchoSession(definition.instructions);
  return (
    <TestChatPanel
      definition={definition}
      identity={identity}
      notice={
        dirty ? (
          <Trans>Testing what's on screen; save to keep it.</Trans>
        ) : undefined
      }
      session={session}
    />
  );
}
