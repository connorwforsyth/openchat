import {
  type SandboxLimits,
  type SandboxProvider,
  type SandboxState,
  sandboxIsolationSchema,
  sandboxProviderSchema,
  sandboxStatusSchema,
} from "@workspace/contract/schemas/sandbox";
import { check, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { conversation } from "./chat";
import { createdAt, idColumn, idRef, oneOf, updatedAt } from "./columns";

// Sandboxes (D7): at most one per conversation.

const SANDBOX_STATES = sandboxStatusSchema.options.map(
  (option) => option.shape.state.value
);

export const sandbox = pgTable(
  "sandbox",
  {
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    /** The provider's own id for the box (container id, microVM id). */
    externalId: text("external_id"),
    id: idColumn("sandbox"),
    isolation: text("isolation")
      .$type<z.infer<typeof sandboxIsolationSchema>>()
      .notNull(),
    limits: jsonb("limits").$type<SandboxLimits>().notNull(),
    previews: jsonb("previews")
      .$type<{ port: number; url: string }[]>()
      .notNull()
      .default([]),
    provider: text("provider").$type<SandboxProvider>().notNull(),
    /** The latest snapshot, if any. */
    snapshotRef: text("snapshot_ref"),
    state: text("state").$type<SandboxState>().notNull(),
    /** Why it failed; safe to show. */
    stateMessage: text("state_message"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sandbox_conversation_uidx").on(t.conversationId),
    check("sandbox_provider", oneOf(t.provider, sandboxProviderSchema.options)),
    check(
      "sandbox_isolation",
      oneOf(t.isolation, sandboxIsolationSchema.options)
    ),
    check("sandbox_state", oneOf(t.state, SANDBOX_STATES)),
  ]
);
