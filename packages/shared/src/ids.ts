import { uuidv7 } from "uuidv7";
import { z } from "zod";

// Ids are UUIDv7 (RFC 9562): 48 bits of millisecond timestamp, then random
// bits. They sort by creation time, so they double as a stable pagination
// cursor and keep B-tree inserts append-mostly, and they fit Postgres's native
// `uuid` type (Postgres 17 in production has no built-in `uuidv7()`, so the app
// generates them). The `uuidv7` package (Apache-2.0, no dependencies) keeps ids
// monotonic within a millisecond, which a hand-rolled version tends to get wrong.
//
// The kind is a compile-time brand only: `Id<"conversation">` and
// `Id<"message">` are both UUIDs on the wire but can't be swapped in code.

/** A branded id. The brand is zod's, so `z.infer` of `idSchema(kind)` is `Id<kind>`. */
export type Id<K extends string> = string & z.$brand<K>;

/** The zod schema for one kind of id: a UUID, branded with the kind. */
export type IdSchema<K extends string> = z.core.$ZodBranded<z.ZodUUID, K>;

export const idSchema = <K extends string>(kind: K): IdSchema<K> =>
  // zod's `brand` return type is conditional on the brand being a literal,
  // which TypeScript can't resolve for a generic `K`; the cast states it.
  z.uuid().describe(`${kind} id (UUIDv7)`).brand<K>() as IdSchema<K>;

/** A new, time-sortable id of the given kind. */
export const newId = <K extends string>(_kind: K): Id<K> => uuidv7() as Id<K>;

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The creation time encoded in a UUIDv7, or `undefined` for any other string
 * (ids minted elsewhere, say by an importer, may be other UUID versions).
 */
export const idTimestamp = (id: string): Date | undefined => {
  if (!UUID_V7.test(id)) {
    return;
  }
  const hex = id.replaceAll("-", "").slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
};
