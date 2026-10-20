import { idSchema } from "@workspace/shared/ids";
import { z } from "zod";

// Primitives every domain shares: ids, timestamps, pagination, JSON values.
// Wire rules, so every client (TypeScript, Swift via OpenAPI) agrees:
// - ids are UUIDv7 strings, branded per kind in TypeScript;
// - timestamps are ISO 8601 strings in UTC, never `Date` objects;
// - money is integer micro-USD (1 USD = 1_000_000), never a float;
// - lists are cursor-paginated (`{ items, nextCursor }`).

export const userIdSchema = idSchema("user");
export const orgIdSchema = idSchema("org");
export const teamIdSchema = idSchema("team");
export const invitationIdSchema = idSchema("invitation");
export const conversationIdSchema = idSchema("conversation");
export const messageIdSchema = idSchema("message");
export const runIdSchema = idSchema("run");
export const libraryItemIdSchema = idSchema("libraryItem");
export const libraryVersionIdSchema = idSchema("libraryVersion");
export const fileIdSchema = idSchema("file");
export const fileChunkIdSchema = idSchema("fileChunk");
export const artifactIdSchema = idSchema("artifact");
export const artifactVersionIdSchema = idSchema("artifactVersion");
export const grantIdSchema = idSchema("grant");
export const shareLinkIdSchema = idSchema("shareLink");
export const memoryVersionIdSchema = idSchema("memoryVersion");
export const feedbackIdSchema = idSchema("feedback");
export const providerKeyIdSchema = idSchema("providerKey");
export const budgetIdSchema = idSchema("budget");
export const transactionIdSchema = idSchema("transaction");
export const decisionIdSchema = idSchema("decision");
export const sandboxIdSchema = idSchema("sandbox");
export const annotationIdSchema = idSchema("annotation");
export const jobIdSchema = idSchema("job");
export const dotIdSchema = idSchema("dot");
export const dotScheduleIdSchema = idSchema("dotSchedule");

export type UserId = z.infer<typeof userIdSchema>;
export type OrgId = z.infer<typeof orgIdSchema>;
export type TeamId = z.infer<typeof teamIdSchema>;
export type InvitationId = z.infer<typeof invitationIdSchema>;
export type ConversationId = z.infer<typeof conversationIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type LibraryItemId = z.infer<typeof libraryItemIdSchema>;
export type LibraryVersionId = z.infer<typeof libraryVersionIdSchema>;
export type FileId = z.infer<typeof fileIdSchema>;
export type FileChunkId = z.infer<typeof fileChunkIdSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type ArtifactVersionId = z.infer<typeof artifactVersionIdSchema>;
export type GrantId = z.infer<typeof grantIdSchema>;
export type ShareLinkId = z.infer<typeof shareLinkIdSchema>;
export type MemoryVersionId = z.infer<typeof memoryVersionIdSchema>;
export type FeedbackId = z.infer<typeof feedbackIdSchema>;
export type ProviderKeyId = z.infer<typeof providerKeyIdSchema>;
export type BudgetId = z.infer<typeof budgetIdSchema>;
export type TransactionId = z.infer<typeof transactionIdSchema>;
export type DecisionId = z.infer<typeof decisionIdSchema>;
export type SandboxId = z.infer<typeof sandboxIdSchema>;
export type AnnotationId = z.infer<typeof annotationIdSchema>;
export type JobId = z.infer<typeof jobIdSchema>;
export type DotId = z.infer<typeof dotIdSchema>;
export type DotScheduleId = z.infer<typeof dotScheduleIdSchema>;

/** An ISO 8601 instant. Servers emit UTC (`Z`); offsets are accepted on input. */
export const timestampSchema = z.iso.datetime({ offset: true });

/** Integer micro-USD, so sums never drift (1 USD = 1_000_000). */
export const microUsdSchema = z.int().min(0);

/** Any JSON value: tool inputs and outputs, provider metadata, data parts. */
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

/** Opaque provider metadata carried through for replay (reasoning signatures, cache hints). */
export const providerMetadataSchema = z.record(
  z.string(),
  z.record(z.string(), jsonValueSchema)
);

/** A short human label: names and titles. */
export const nameSchema = z.string().trim().min(1).max(200);

export const descriptionSchema = z.string().max(2000);

/**
 * Cursor pagination input. Cursors are opaque strings minted by the server;
 * clients only echo `nextCursor` back.
 */
export const pageInputSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.int().min(1).max(100).default(50),
});
export type PageInput = z.infer<typeof pageInputSchema>;

/** A page of `item`, with the cursor for the next one (`null` at the end). */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

/** The empty success body for commands that return nothing useful. */
export const okSchema = z.object({ ok: z.literal(true) });
