import { libraryItemIdSchema } from "@workspace/contract/schemas/common";
import type { Result } from "@workspace/shared/result";
import { z } from "zod";

import { pickedSkillOptionSchema } from "../schemas";

// Where a chat's unsent draft waits (147): what was typed, its mentions and
// the skills picked for it, per conversation, so switching chats or
// reloading doesn't lose it. The web app keeps drafts in the browser
// (`draft-store.storage.ts`); tests use `draft-store.memory.ts`.
//
// Synchronous on purpose: switching chats swaps the draft in the same frame,
// so the old chat's text never shows under the new chat's messages, and the
// browser's storage is synchronous anyway.

/** The new-chat composer's draft, before the chat it starts has an id. */
export const NEW_CHAT_DRAFT_KEY = "new";

/** A conversation id, or `NEW_CHAT_DRAFT_KEY`. */
export const draftKeySchema = z.string().min(1).max(128);
export type DraftKey = z.infer<typeof draftKeySchema>;

const attrsSchema = z.record(z.string(), z.json());

/**
 * A node of the editor's ProseMirror JSON (`editor.getJSON()`): paragraphs,
 * text with an inline `code` mark, hard breaks and mentions (see
 * editor/extensions.ts). Loose about node names so a draft saved before a
 * schema change still parses; the editor drops what it doesn't know.
 */
export const draftNodeSchema = z.object({
  attrs: attrsSchema.optional(),
  get content(): z.ZodOptional<z.ZodArray<typeof draftNodeSchema>> {
    return z.array(draftNodeSchema).optional();
  },
  marks: z
    .array(z.object({ attrs: attrsSchema.optional(), type: z.string().min(1) }))
    .optional(),
  text: z.string().optional(),
  type: z.string().min(1),
});
export type DraftNode = z.infer<typeof draftNodeSchema>;

/**
 * A draft as stored, version 1. Attachments aren't kept: a `File` can't be
 * written to storage, and a reload can't read it back from the disk without
 * the person picking it again. They stay in the composer while it's mounted.
 */
export const draftV1Schema = z.object({
  /** The editor's document; mentions are nodes in it. */
  doc: draftNodeSchema,
  /** Skills picked for the message (127), in the order picked. */
  skills: z.array(pickedSkillOptionSchema),
  /** The prompt template the text started from, if any. */
  templateId: libraryItemIdSchema.nullable(),
  version: z.literal(1),
});

/**
 * Every stored shape this build reads. A new version goes in here with a
 * migration to the current one in `parseDraft`, so drafts saved by an older
 * build survive an upgrade.
 */
export const storedDraftSchema = z.discriminatedUnion("version", [
  draftV1Schema,
]);

/** The current draft shape. */
export const draftSchema = draftV1Schema;
export type Draft = z.infer<typeof draftSchema>;

/**
 * A stored value as the current draft shape, or `null` when it isn't one
 * this build can read (corrupt, or written by a newer build). Losing a
 * draft is better than a composer that won't load.
 */
export const parseDraft = (value: unknown): Draft | null => {
  const parsed = storedDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const draftStoreErrorSchema = z.discriminatedUnion("type", [
  /** Storage is off (private mode, blocked) or full. The composer still works; the draft isn't kept. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type DraftStoreError = z.infer<typeof draftStoreErrorSchema>;

export interface DraftStore {
  /** Forgets the draft (it was sent, or emptied). */
  readonly clear: (key: DraftKey) => Result<void, DraftStoreError>;
  /** The saved draft; `null` when there's none, or none this build can read. */
  readonly load: (key: DraftKey) => Result<Draft | null, DraftStoreError>;
  /** Replaces the draft. The last write wins, across tabs too. */
  readonly save: (key: DraftKey, draft: Draft) => Result<void, DraftStoreError>;
}
