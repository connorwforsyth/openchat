import { z } from "zod";

// Expected failures, returned as values (D8). Anything else a query can hit
// (the database is down, a constraint we didn't plan for) is thrown and
// caught once at the shell: it's a bug or an outage, not a result.

export const dbConfigErrorSchema = z.discriminatedUnion("type", [
  /** No `DATABASE_URL`: the app runs without persistence and says so. */
  z.object({ type: z.literal("not_configured") }),
  z.object({ message: z.string(), type: z.literal("invalid_url") }),
]);
export type DbConfigError = z.infer<typeof dbConfigErrorSchema>;

export const notFoundErrorSchema = z.object({
  entity: z.string(),
  id: z.string(),
  type: z.literal("not_found"),
});
export type NotFoundError = z.infer<typeof notFoundErrorSchema>;

export const conflictReasonSchema = z.enum([
  /** The conversation's context is fixed after its first message (D17). */
  "context_locked",
  /** A parent message from another conversation. */
  "wrong_conversation",
  /** A run can't move from its current status to the requested one. */
  "invalid_transition",
  /** An edit based on a version that is no longer current. */
  "version_mismatch",
  /** A permission level that doesn't suit the resource type. */
  "invalid_permission",
  /** Nothing to publish: the draft is unchanged since the last version. */
  "nothing_to_publish",
]);
export type ConflictReason = z.infer<typeof conflictReasonSchema>;

export const conflictErrorSchema = z.object({
  /** Extra detail for logs (`queued -> succeeded`); never user content. */
  detail: z.string().optional(),
  reason: conflictReasonSchema,
  type: z.literal("conflict"),
});
export type ConflictError = z.infer<typeof conflictErrorSchema>;

/** A stored message whose `partsVersion` this build can't read. */
export const unsupportedPartsVersionErrorSchema = z.object({
  messageId: z.string(),
  type: z.literal("unsupported_parts_version"),
  version: z.int(),
});
export type UnsupportedPartsVersionError = z.infer<
  typeof unsupportedPartsVersionErrorSchema
>;

export const notFound = (entity: string, id: string): NotFoundError => ({
  entity,
  id,
  type: "not_found",
});

export const conflict = (
  reason: ConflictReason,
  detail?: string
): ConflictError =>
  detail === undefined
    ? { reason, type: "conflict" }
    : { detail, reason, type: "conflict" };
