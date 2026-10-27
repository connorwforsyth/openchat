import {
  type AnnotationsData,
  annotationsParts,
  annotationsText,
} from "@workspace/ai/messages/annotations";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  CreateRunInput,
  TurnDelivery,
} from "@workspace/contract/schemas/runs";
import { useMemo, useRef } from "react";

import type { AnnotateSink } from "./sink";

// Annotate's sink in a chat: notes go out as the person's next message.
// While an answer is being written they steer it (#244's steer, taken at
// the answer's next step); otherwise they start the next turn, the way the
// composer sends. Plan mode and the turn's other switches come with the
// run's fields, as for any message.

/** The notes as a message `useChat` sends: its data part named the AI SDK way. Pure. */
export const annotationsMessage = (data: AnnotationsData) => {
  const [text, notes] = annotationsParts(data);
  return {
    parts: [text, { data: notes.data, type: `data-${notes.name}` as const }],
  };
};

/** The notes as a run's `input`, sent while an answer is written. Pure. */
export const annotationsInput = (
  _text: string,
  data: AnnotationsData,
  parentId: MessageId | null
): CreateRunInput["input"] => ({
  parentId,
  parts: [...annotationsParts(data)],
  type: "message",
});

const ignore = () => undefined;

export const useChatAnnotateSink = ({
  busy,
  conversation,
  sendBusy,
  sendMessage,
  stopReading,
  waiting,
}: {
  /** An answer is being written: the notes steer it. */
  readonly busy: boolean;
  /** The chat, once it exists; a viewer can't write in it. */
  readonly conversation: Pick<Conversation, "myPermission"> | undefined;
  readonly sendBusy: (
    text: string,
    data: AnnotationsData,
    delivery: TurnDelivery
  ) => Promise<void>;
  readonly sendMessage: (
    message: ReturnType<typeof annotationsMessage>
  ) => Promise<void>;
  readonly stopReading: () => Promise<void>;
  /** A change waits for approval; like any message, the notes move on. */
  readonly waiting: boolean;
}): AnnotateSink | null => {
  const canSend =
    conversation !== undefined && conversation.myPermission !== "viewer";
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  return useMemo(
    () =>
      canSend
        ? {
            mode: busy ? "steer" : "send",
            send: async (data: AnnotationsData) => {
              // The server stops an answer waiting on approval when a
              // message comes, so this page stops following it first.
              if (waitingRef.current) {
                await stopReading().catch(ignore);
              }
              if (busy) {
                await sendBusy(annotationsText(data), data, "steer");
                return;
              }
              await sendMessage(annotationsMessage(data));
            },
          }
        : null,
    [busy, canSend, sendBusy, sendMessage, stopReading]
  );
};
