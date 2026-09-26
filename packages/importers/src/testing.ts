import { readFileSync } from "node:fs";

import type { MessagePart } from "@workspace/contract/schemas/message-parts";

import type { ImportedConversation, ImportedMessage } from "./schema";

// Test helpers: fixture loading and tree shorthand, so assertions read as the
// tree they expect.

/** A fixture from `packages/importers/fixtures`, parsed. */
export const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")
  );

/** The fixture's raw text, for the streaming parser. */
export const fixtureText = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

/** `{ child: parent }` for every message: the tree's shape at a glance. */
export const parents = (
  conversation: ImportedConversation
): Record<string, string | null> =>
  Object.fromEntries(
    conversation.messages.map((m) => [m.sourceId, m.parentSourceId])
  );

export const byId = (
  conversation: ImportedConversation,
  sourceId: string
): ImportedMessage => {
  const found = conversation.messages.find((m) => m.sourceId === sourceId);
  if (!found) {
    throw new Error(`no message ${sourceId}`);
  }
  return found;
};

export const partTypes = (message: ImportedMessage): string[] =>
  message.parts.map((part) =>
    part.type === "data" ? `data:${part.name}` : part.type
  );

export const partOf = <T extends MessagePart["type"]>(
  message: ImportedMessage,
  type: T
): Extract<MessagePart, { type: T }> => {
  const found = message.parts.find((part) => part.type === type);
  if (!found) {
    throw new Error(`no ${type} part on ${message.sourceId}`);
  }
  return found as Extract<MessagePart, { type: T }>;
};
