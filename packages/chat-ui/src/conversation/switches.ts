import type {
  LibraryItemId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { ModelRef } from "@workspace/contract/schemas/models";

// Where the conversation says who answers changed (107). Pure: the view
// draws a marker before each message this returns.

/**
 * What changed before an answer. An agent change wins: the marker names the
 * agent, with its model after it when that changed too. Going from an agent
 * back to a plain model is a model switch.
 */
export type AnswerSwitch =
  | {
      readonly agentId: LibraryItemId;
      readonly kind: "agent";
      /** Set when the model changed as well. */
      readonly model: ModelRef | null;
    }
  | { readonly kind: "model"; readonly model: ModelRef };

interface Answerer {
  readonly agentId: LibraryItemId | null;
  readonly model: ModelRef;
}

/**
 * Who wrote an answer, or `undefined` when that isn't known yet: an answer
 * still streaming in from the live tail, which has no `model` until the
 * stored copy arrives. Such an answer neither shows a marker nor moves the
 * baseline, so the marker can't flicker on and off while it streams.
 */
const answererOf = (message: Message): Answerer | undefined =>
  message.role === "assistant" && message.model !== null
    ? { agentId: message.agent?.id ?? null, model: message.model }
    : undefined;

/**
 * The answers on a branch (root first) whose model or agent differs from the
 * answer before them, and what changed. The first answer has none. Agents
 * compare by item, not version: editing an agent isn't switching to another.
 */
export const answerSwitches = (
  messages: readonly Message[]
): ReadonlyMap<MessageId, AnswerSwitch> => {
  const switches = new Map<MessageId, AnswerSwitch>();
  let previous: Answerer | undefined;
  for (const message of messages) {
    const answerer = answererOf(message);
    if (answerer === undefined) {
      continue;
    }
    if (previous !== undefined) {
      const modelChanged = answerer.model !== previous.model;
      if (answerer.agentId !== null && answerer.agentId !== previous.agentId) {
        switches.set(message.id, {
          agentId: answerer.agentId,
          kind: "agent",
          model: modelChanged ? answerer.model : null,
        });
      } else if (modelChanged || answerer.agentId !== previous.agentId) {
        switches.set(message.id, { kind: "model", model: answerer.model });
      }
    }
    previous = answerer;
  }
  return switches;
};
