import { type Id, newId } from "@workspace/shared/ids";
import { type SQL, sql } from "drizzle-orm";
import {
  customType,
  type PgColumn,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Column helpers shared by every table. Ids are UUIDv7 minted by the app
// (`@workspace/shared/ids`): Postgres 17 has no built-in `uuidv7()`, and the
// brand keeps a conversation id from being passed where a message id belongs.

/** The primary key: a UUIDv7 of the given kind, generated on insert when omitted. */
export const idColumn = <K extends string>(kind: K) =>
  uuid("id")
    .primaryKey()
    .$type<Id<K>>()
    .$defaultFn(() => newId(kind));

/** A uuid column holding an id of the given kind (foreign keys, polymorphic refs). */
export const idRef = <K extends string>(name: string, _kind: K) =>
  uuid(name).$type<Id<K>>();

/** Who a grant, budget, key or balance belongs to: a user, a team or an org. */
export type PrincipalId = Id<"user"> | Id<"team"> | Id<"org">;

export const principalIdRef = (name: string) => uuid(name).$type<PrincipalId>();

/**
 * A chat context's team or org. The Personal context stores the owner's
 * personal org, so every context is one of the two.
 */
export const contextIdRef = (name: string) =>
  uuid(name).$type<Id<"team"> | Id<"org">>();

/** `timestamptz`, as a `Date`. Every instant is stored with its zone so UTC is never guessed. */
export const instant = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const createdAt = () => instant("created_at").notNull().defaultNow();

export const updatedAt = () =>
  instant("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** A full-text document. Read-only: only ever a generated column. */
export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * A pgvector `vector` with no fixed dimension. The embedding model (and so
 * the dimension) comes from app.config.yaml and can change, so the column
 * can't pin one; per-dimension partial HNSW indexes cover the common sizes
 * (see `file_chunk`). The driver speaks pgvector's text form, `[1,2,3]`.
 */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  fromDriver: (value) =>
    typeof value === "string"
      ? value
          .slice(1, -1)
          .split(",")
          .map((part) => Number(part))
      : (value as number[]),
  toDriver: (value) => `[${value.join(",")}]`,
});

/** The text-search configuration. `simple` doesn't stem, so no language is favoured. */
export const TEXT_SEARCH_CONFIG = "simple";

const LITERAL = /^[a-z0-9_:-]+$/;

/**
 * `column IN ('a', 'b')` with the values inlined, for CHECK constraints (DDL
 * can't take bind parameters). Values come from the contract's zod enums, so
 * the database and the API agree on every status and kind.
 */
export const oneOf = (
  column: PgColumn | SQL,
  values: readonly string[]
): SQL => {
  for (const value of values) {
    if (!LITERAL.test(value)) {
      throw new Error(`Unsafe literal in a CHECK constraint: ${value}`);
    }
  }
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
};
