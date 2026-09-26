import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// Keyset pagination. A cursor is the sort key and id of the last row a client
// saw, base64url-encoded so clients treat it as opaque (contract `common`).
// Keyset rather than offset: rows added while someone pages don't shift or
// repeat what they see.

export const cursorKeySchema = z.object({
  /** The last row's id, the tiebreak. */
  id: z.uuid(),
  /** The last row's sort value: an ISO instant or a number. */
  key: z.union([z.iso.datetime({ offset: true }), z.number()]),
});
export type CursorKey = z.infer<typeof cursorKeySchema>;

export const invalidCursorErrorSchema = z.object({
  type: z.literal("invalid_cursor"),
});
export type InvalidCursorError = z.infer<typeof invalidCursorErrorSchema>;

export interface Page<T> {
  readonly items: readonly T[];
  /** `null` at the end. */
  readonly nextCursor: string | null;
}

export const encodeCursor = (key: CursorKey): string =>
  Buffer.from(JSON.stringify([key.key, key.id])).toString("base64url");

export const decodeCursor = (
  cursor: string
): Result<CursorKey, InvalidCursorError> => {
  try {
    const [key, id] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as unknown[];
    const parsed = cursorKeySchema.safeParse({ id, key });
    return parsed.success ? ok(parsed.data) : err({ type: "invalid_cursor" });
  } catch {
    return err({ type: "invalid_cursor" });
  }
};

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only says there
 * is more, and the last returned row becomes the cursor.
 */
export const toPage = <T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => CursorKey
): Page<T> => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(keyOf(last))
        : null,
  };
};

/** Rows from `db.execute`: postgres.js returns an array, PGlite `{ rows }`. */
export const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : (result as { rows: T[] }).rows;
