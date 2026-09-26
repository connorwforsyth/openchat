import {
  type MemoryMode,
  memoryModeSchema,
  type memoryVersionSourceSchema,
} from "@workspace/contract/schemas/memory";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { z } from "zod";

import { user } from "./auth";
import { createdAt, idColumn, idRef, oneOf, updatedAt } from "./columns";

// Memory (D20): one Markdown file per user; every change is a version, so
// "Memory updated · Undo" is a revert to the previous one.

export const memory = pgTable(
  "memory",
  {
    content: text("content").notNull().default(""),
    /** `null` before the first write. */
    currentVersionId: idRef("current_version_id", "memoryVersion").references(
      (): AnyPgColumn => memoryVersion.id,
      { onDelete: "set null" }
    ),
    mode: text("mode").$type<MemoryMode>().notNull().default("auto"),
    updatedAt: updatedAt(),
    userId: idRef("user_id", "user")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [check("memory_mode", oneOf(t.mode, memoryModeSchema.options))]
);

export const memoryVersion = pgTable(
  "memory_version",
  {
    content: text("content").notNull(),
    createdAt: createdAt(),
    id: idColumn("memoryVersion"),
    number: integer("number").notNull(),
    /** Who changed it: the user, an agent's run, or a revert. Kept as history, so no foreign keys. */
    source: jsonb("source")
      .$type<z.infer<typeof memoryVersionSourceSchema>>()
      .notNull(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("memory_version_number_uidx").on(t.userId, t.number),
    check("memory_version_number_positive", sql`${t.number} >= 1`),
  ]
);
