"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { ComposerLoader } from "@workspace/composer/components/composer-loader";
import type {
  ComposerStatus,
  ComposerValue,
} from "@workspace/composer/schemas";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import { RotateCcwIcon } from "@workspace/icons";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import { type ComponentType, memo, type ReactNode, useCallback } from "react";

// The builder's live test chat (010): the real composer over a small
// message list. It doesn't depend on the chat UI package; where the answers
// come from is a `TestChatSession` the page provides (runs against the
// draft in the app, a scripted echo in the demo and tests).

export interface TestChatSession {
  readonly error: string | null;
  readonly messages: readonly UIMessage[];
  /** Starts over with an empty conversation. */
  readonly reset: () => void;
  readonly send: (text: string) => void;
  readonly status: ComposerStatus;
  readonly stop: () => void;
}

export interface TestChatProps {
  readonly definition: AgentDefinition;
  /** A note above the chat, like what the test runs against. */
  readonly notice?: ReactNode;
}

/** How the page plugs a session in: a hook-backed component per builder. */
export type TestChatComponent = ComponentType<TestChatProps>;

const MessageRow = memo(function Row({
  message,
}: {
  readonly message: UIMessage;
}) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.role === "assistant" ? (
          <MessageResponse>{text}</MessageResponse>
        ) : (
          <p className="whitespace-pre-wrap">{text}</p>
        )}
      </MessageContent>
    </Message>
  );
});

function StarterButton({
  disabled,
  onSend,
  text,
}: {
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
  readonly text: string;
}) {
  const send = useCallback(() => onSend(text), [onSend, text]);
  return (
    <Button disabled={disabled} onClick={send} size="sm" variant="outline">
      {text}
    </Button>
  );
}

export function TestChatPanel({
  definition,
  notice,
  session,
}: TestChatProps & { readonly session: TestChatSession }) {
  const { t } = useLingui();
  const busy = session.status === "submitted" || session.status === "streaming";
  const { send } = session;
  const submit = useCallback(
    (value: ComposerValue) => {
      if (value.text) {
        send(value.text);
      }
    },
    [send]
  );
  const starters = definition.conversationStarters.filter(
    (starter) => starter.trim() !== ""
  );

  return (
    <section
      aria-label={t`Test chat`}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">
          <Trans>Test chat</Trans>
        </h2>
        <Button
          disabled={session.messages.length === 0 || busy}
          onClick={session.reset}
          size="sm"
          variant="ghost"
        >
          <RotateCcwIcon data-icon="inline-start" />
          <Trans>Start over</Trans>
        </Button>
      </header>
      {notice ? (
        <p className="text-muted-foreground text-xs">{notice}</p>
      ) : null}

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1 rounded-lg border border-border bg-background">
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              {session.messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <p className="text-muted-foreground text-sm">
                    <Trans>Try the draft before you publish it.</Trans>
                  </p>
                  {starters.length > 0 ? (
                    <ul className="flex flex-wrap justify-center gap-2">
                      {starters.map((starter) => (
                        <li key={starter}>
                          <StarterButton
                            disabled={busy}
                            onSend={session.send}
                            text={starter}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                session.messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <MessageRow message={message} />
                  </MessageScrollerItem>
                ))
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {session.error ? (
        <Alert variant="destructive">
          <AlertDescription>{session.error}</AlertDescription>
        </Alert>
      ) : null}

      <ComposerLoader
        onStop={session.stop}
        onSubmit={submit}
        placeholder={t`Message the draft`}
        status={session.status}
      />
    </section>
  );
}
