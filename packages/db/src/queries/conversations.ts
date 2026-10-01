import type {
  ConversationId,
  MessageId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  Conversation,
  ConversationPermission,
} from "@workspace/contract/schemas/conversations";
import type { MessageRole } from "@workspace/contract/schemas/messages";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { SearchHit } from "@workspace/contract/schemas/search";
import type {
  ChatContext,
  ChatContextType,
  Principal,
} from "@workspace/contract/schemas/tenancy";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import {
  and,
  asc,
  desc,
  eq,
  getColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
} from "../errors";
import { resourceGrant, shareLink } from "../schema/access";
import { user } from "../schema/auth";
import {
  ACTIVE_RUN_STATUSES,
  type ConversationPurpose,
  conversation,
  conversationParticipant,
  message,
  run,
} from "../schema/chat";
import { TEXT_SEARCH_CONFIG } from "../schema/columns";
import { deleteGrantsForResource, hasLiveShareLink, heldBy } from "./grants";
import { type BranchRows, getBranchPath, newestLeafId } from "./messages";
import {
  decodeCursor,
  type InvalidCursorError,
  type Page,
  rowsOf,
  toPage,
} from "./page";

// Conversations (D17, D25). Access is ownership plus `resource_grant`; the
// caller passes the principals it acts as (`loadPrincipals`) and every read
// is scoped by them, so a query can't leak a chat by forgetting a check.

const { titleSearch: _titleSearch, ...conversationColumns } =
  getColumns(conversation);

export type ConversationRow = Omit<
  typeof conversation.$inferSelect,
  "titleSearch"
>;

/** A conversation as one user sees it: their access, their state, its visibility. */
export interface ConversationView extends ConversationRow {
  readonly activeLeafId: MessageId | null;
  readonly followingUserId: UserId | null;
  readonly lastReadAt: Date | null;
  /** `null` when the user has no access at all. */
  readonly myPermission: ConversationPermission | null;
  readonly pinnedAt: Date | null;
  readonly visibility: Conversation["visibility"];
}

/** Who is asking: the user and the principals they act as. */
export interface Viewer {
  readonly principals: readonly Principal[];
  readonly userId: UserId;
}

/** The context as stored: Personal is the owner's personal org (D17). */
export type StoredContext =
  | { readonly id: OrgId; readonly type: "personal" }
  | { readonly id: TeamId; readonly type: "team" }
  | { readonly id: OrgId; readonly type: "org" };

const grantedAtLeast = (viewer: Viewer, levels: readonly string[]): SQL =>
  sql`exists (select 1 from ${resourceGrant} where ${resourceGrant.resourceType} = 'conversation' and ${resourceGrant.resourceId} = ${conversation.id} and ${resourceGrant.permission} in (${sql.join(
    levels.map((level) => sql`${level}`),
    sql`, `
  )}) and ${heldBy(viewer.principals)})`;

const canRead = (viewer: Viewer): SQL =>
  sql`(${conversation.ownerId} = ${viewer.userId} or ${grantedAtLeast(viewer, ["viewer", "editor"])})`;

const viewColumns = (viewer: Viewer) => ({
  ...conversationColumns,
  activeLeafId: conversationParticipant.activeLeafId,
  followingUserId: conversationParticipant.followingUserId,
  lastReadAt: conversationParticipant.lastReadAt,
  myPermission: sql<ConversationPermission | null>`case
    when ${conversation.ownerId} = ${viewer.userId} then 'owner'
    when ${grantedAtLeast(viewer, ["editor"])} then 'editor'
    when ${grantedAtLeast(viewer, ["viewer"])} then 'viewer'
  end`,
  pinnedAt: conversationParticipant.pinnedAt,
  visibility: sql<Conversation["visibility"]>`case
    when ${hasLiveShareLink("conversation", conversation.id)} then 'public-link'
    when exists (select 1 from ${resourceGrant} where ${resourceGrant.resourceType} = 'conversation' and ${resourceGrant.resourceId} = ${conversation.id}) then 'shared'
    else 'private'
  end`,
});

const selectViews = (db: Db, viewer: Viewer) =>
  db
    .select(viewColumns(viewer))
    .from(conversation)
    .leftJoin(
      conversationParticipant,
      and(
        eq(conversationParticipant.conversationId, conversation.id),
        eq(conversationParticipant.userId, viewer.userId)
      )
    );

export interface NewConversation {
  readonly context: StoredContext;
  readonly defaultTarget?: RunTarget | null;
  readonly ownerId: UserId;
  /** `test` for an Agent Builder test chat; `chat` by default. */
  readonly purpose?: ConversationPurpose;
  readonly title?: string | null;
}

/** Creates a conversation and the owner's participant row. */
export const createConversation = (
  db: Db,
  input: NewConversation
): Promise<ConversationRow> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .insert(conversation)
      .values({
        contextId: input.context.id,
        contextType: input.context.type,
        defaultTarget: input.defaultTarget ?? null,
        ownerId: input.ownerId,
        purpose: input.purpose ?? "chat",
        title: input.title ?? null,
      })
      .returning(conversationColumns);
    if (!row) {
      throw new Error("insert returned no row");
    }
    await tx
      .insert(conversationParticipant)
      .values({ conversationId: row.id, userId: input.ownerId });
    return row;
  });

/** One conversation, if `viewer` may read it (`not_found` otherwise, so ids don't leak). */
export const getConversation = async (
  db: Db,
  id: ConversationId,
  viewer: Viewer
): AsyncResult<ConversationView, NotFoundError> => {
  const [row] = await selectViews(db, viewer).where(
    and(eq(conversation.id, id), canRead(viewer))
  );
  return row ? ok(row) : err(notFound("conversation", id));
};

export interface ConversationWithBranch {
  readonly branch: BranchRows & { readonly leafId: MessageId | null };
  readonly conversation: ConversationView;
}

/**
 * A conversation with the branch to show: `leafId` if given, else the
 * viewer's `activeLeafId`, else the newest leaf.
 */
export const getConversationWithBranch = async (
  db: Db,
  id: ConversationId,
  viewer: Viewer,
  leafId?: MessageId
): AsyncResult<ConversationWithBranch, NotFoundError> => {
  const found = await getConversation(db, id, viewer);
  if (!found.ok) {
    return found;
  }
  const leaf =
    leafId ?? found.value.activeLeafId ?? (await newestLeafId(db, id));
  if (leaf === null) {
    return ok({
      branch: { leafId: null, messages: [], siblings: [] },
      conversation: found.value,
    });
  }
  const branch = await getBranchPath(db, id, leaf);
  return branch.ok
    ? ok({
        branch: { ...branch.value, leafId: leaf },
        conversation: found.value,
      })
    : branch;
};

export interface ListConversationsInput {
  readonly archived?: boolean;
  readonly contextType?: ChatContextType;
  readonly cursor?: string;
  readonly limit: number;
  /** `shared`: conversations others granted the viewer. */
  readonly ownership?: "mine" | "shared" | "all";
  readonly pinned?: boolean;
}

/** `true`: the timestamp is set (archived, pinned); `false`: it isn't; `undefined`: either. */
const isSetFilter = (
  column: SQLWrapper,
  wanted: boolean | undefined
): SQL | undefined => {
  if (wanted === undefined) {
    return;
  }
  return wanted ? isNotNull(column) : isNull(column);
};

const ownedBy = (
  viewer: Viewer,
  ownership: NonNullable<ListConversationsInput["ownership"]>
): SQL | undefined => {
  switch (ownership) {
    case "mine":
      return eq(conversation.ownerId, viewer.userId);
    case "shared":
      return and(
        ne(conversation.ownerId, viewer.userId),
        grantedAtLeast(viewer, ["viewer", "editor"])
      );
    case "all":
      return canRead(viewer);
    default:
      return ownership satisfies never;
  }
};

const activityOf = sql<Date>`coalesce(${conversation.lastMessageAt}, ${conversation.createdAt})`;

// Builder test chats are scratch space: reachable by id while the builder
// holds them, but never part of anyone's history or search (ticket 033).
const inHistory = eq(conversation.purpose, "chat");

/** The viewer's conversations, most recently active first. */
export const listConversations = async (
  db: Db,
  viewer: Viewer,
  input: ListConversationsInput
): AsyncResult<Page<ConversationView>, InvalidCursorError> => {
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  if (cursor && !cursor.ok) {
    return cursor;
  }
  const rows = await selectViews(db, viewer)
    .where(
      and(
        inHistory,
        ownedBy(viewer, input.ownership ?? "all"),
        isSetFilter(conversation.archivedAt, input.archived ?? false),
        input.contextType === undefined
          ? undefined
          : eq(conversation.contextType, input.contextType),
        isSetFilter(conversationParticipant.pinnedAt, input.pinned),
        cursor?.ok
          ? sql`(${activityOf}, ${conversation.id}) < (${String(cursor.value.key)}::timestamptz, ${cursor.value.id}::uuid)`
          : undefined
      )
    )
    .orderBy(desc(activityOf), desc(conversation.id))
    .limit(input.limit + 1);
  return ok(
    toPage(rows, input.limit, (row) => ({
      id: row.id,
      key: (row.lastMessageAt ?? row.createdAt).toISOString(),
    }))
  );
};

export interface ConversationPatch {
  readonly archived?: boolean;
  readonly defaultTarget?: RunTarget | null;
  readonly title?: string;
}

export const updateConversation = async (
  db: Db,
  id: ConversationId,
  patch: ConversationPatch
): AsyncResult<ConversationRow, NotFoundError> => {
  const [row] = await db
    .update(conversation)
    .set({
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.defaultTarget === undefined
        ? {}
        : { defaultTarget: patch.defaultTarget }),
      ...(patch.archived === undefined
        ? {}
        : { archivedAt: patch.archived ? new Date() : null }),
    })
    .where(eq(conversation.id, id))
    .returning(conversationColumns);
  return row ? ok(row) : err(notFound("conversation", id));
};

/** Changes the chat context; only before the first message (D17). */
export const setConversationContext = async (
  db: Db,
  id: ConversationId,
  context: StoredContext
): AsyncResult<ConversationRow, NotFoundError | ConflictError> => {
  const [row] = await db
    .update(conversation)
    .set({ contextId: context.id, contextType: context.type })
    .where(and(eq(conversation.id, id), isNull(conversation.contextLockedAt)))
    .returning(conversationColumns);
  if (row) {
    return ok(row);
  }
  const [exists] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(eq(conversation.id, id));
  return err(
    exists ? conflict("context_locked") : notFound("conversation", id)
  );
};

export interface ParticipantPatch {
  readonly activeLeafId?: MessageId | null;
  readonly followingUserId?: UserId | null;
  readonly lastReadAt?: Date;
  readonly pinned?: boolean;
}

/** Upserts one user's state in a conversation. Grants nothing (D25). */
export const setParticipantState = async (
  db: Db,
  conversationId: ConversationId,
  userId: UserId,
  patch: ParticipantPatch
): Promise<typeof conversationParticipant.$inferSelect> => {
  const values = {
    ...(patch.activeLeafId === undefined
      ? {}
      : { activeLeafId: patch.activeLeafId }),
    ...(patch.followingUserId === undefined
      ? {}
      : { followingUserId: patch.followingUserId }),
    ...(patch.lastReadAt === undefined ? {} : { lastReadAt: patch.lastReadAt }),
    ...(patch.pinned === undefined
      ? {}
      : { pinnedAt: patch.pinned ? new Date() : null }),
  };
  const [row] = await db
    .insert(conversationParticipant)
    .values({ conversationId, userId, ...values })
    .onConflictDoUpdate({
      set: { ...values, updatedAt: new Date() },
      target: [
        conversationParticipant.conversationId,
        conversationParticipant.userId,
      ],
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return row;
};

/** Deletes a conversation with its messages, runs, grants and share links. */
export const deleteConversation = (
  db: Db,
  id: ConversationId
): AsyncResult<void, NotFoundError> =>
  db.transaction(async (tx) => {
    await deleteGrantsForResource(tx, {
      resourceId: id,
      resourceType: "conversation",
    });
    const deleted = await tx
      .delete(conversation)
      .where(eq(conversation.id, id))
      .returning({ id: conversation.id });
    return deleted.length > 0
      ? ok(undefined)
      : err(notFound("conversation", id));
  });

/**
 * Deletes builder test chats with no activity since `before`, with their
 * grants and share links, skipping any with a run still going. Returns how
 * many went.
 */
export const deleteStaleTestChats = (db: Db, before: Date): Promise<number> =>
  db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        and(
          eq(conversation.purpose, "test"),
          // `createdAt` first so the partial index narrows the scan.
          lt(conversation.createdAt, before),
          // A raw expression has no column codec, so the Date goes in as ISO
          // text: postgres-js can't bind a Date object itself.
          sql`${activityOf} < ${before.toISOString()}::timestamptz`,
          sql`not exists (select 1 from ${run} where ${run.conversationId} = ${conversation.id} and ${inArray(run.status, [...ACTIVE_RUN_STATUSES])})`
        )
      );
    if (stale.length === 0) {
      return 0;
    }
    // Grants and links have no foreign key to the chat (resources are
    // polymorphic), so they go first, as in `deleteConversation`.
    const ids = stale.map(({ id }) => id);
    await tx
      .delete(resourceGrant)
      .where(
        and(
          eq(resourceGrant.resourceType, "conversation"),
          inArray(resourceGrant.resourceId, ids)
        )
      );
    await tx
      .delete(shareLink)
      .where(
        and(
          eq(shareLink.resourceType, "conversation"),
          inArray(shareLink.resourceId, ids)
        )
      );
    const deleted = await tx
      .delete(conversation)
      .where(inArray(conversation.id, ids))
      .returning({ id: conversation.id });
    return deleted.length;
  });

/** The contract's `ChatContext` for a stored one (Personal hides its org id). */
export const toChatContext = (context: StoredContext): ChatContext =>
  context.type === "personal" ? { type: "personal" } : context;

// --- Full-text search ---

// ts_headline marks matches with these; `parseHeadline` turns them into
// offsets, so results never carry HTML (contract `search`).
const START = "\u0002";
const STOP = "\u0003";
const HEADLINE_OPTIONS = `StartSel=${START}, StopSel=${STOP}, MaxFragments=2, MaxWords=24, MinWords=8, FragmentDelimiter=" … "`;

/** A `ts_headline` result as plain text plus highlight spans (UTF-16 offsets). */
export const parseHeadline = (
  headline: string
): Pick<SearchHit, "highlights" | "snippet"> => {
  const highlights: { end: number; start: number }[] = [];
  let snippet = "";
  let start = -1;
  for (const char of headline) {
    if (char === START) {
      start = snippet.length;
    } else if (char === STOP) {
      if (start >= 0) {
        highlights.push({ end: snippet.length, start });
      }
      start = -1;
    } else {
      snippet += char;
    }
  }
  return { highlights, snippet };
};

export interface SearchConversationsInput {
  readonly archived?: boolean;
  readonly contextType?: ChatContextType;
  readonly cursor?: string;
  readonly limit: number;
  readonly query: string;
}

const offsetOf = (
  cursor: string | undefined
): Result<number, InvalidCursorError> => {
  if (cursor === undefined) {
    return ok(0);
  }
  const offset = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isSafeInteger(offset) && offset >= 0
    ? ok(offset)
    : err({ type: "invalid_cursor" });
};

const TRAILING_WORD = /(\S+)$/u;
const NOT_A_LEXEME_CHAR = /[^\p{L}\p{N}]+/gu;

/**
 * The search box is searched as it's typed (⌘K, D28), so the last word may be
 * half a word: "que" should find "Query". Complete words keep
 * `websearch_to_tsquery` semantics (quotes, `-word`, `or`); the last one also
 * matches as a prefix (`to_tsquery('que:*')`). A trailing space, a quote or a
 * `-` means the person is past that word or wants it exact, so no prefix.
 *
 * The prefix term is rebuilt from letters and digits only, so no tsquery
 * operator (`&|!<>():*'\`) can reach `to_tsquery`; both parts are bound
 * parameters.
 */
export const prefixSearchParts = (
  raw: string
): { readonly head: string; readonly prefix: string | null } => {
  const word = TRAILING_WORD.exec(raw)?.[1];
  const quotes = raw.split('"').length - 1;
  if (!word || word.includes('"') || word.startsWith("-") || quotes % 2 === 1) {
    return { head: raw, prefix: null };
  }
  const pieces = word.split(NOT_A_LEXEME_CHAR).filter(Boolean);
  if (pieces.length === 0 || word.toLowerCase() === "or") {
    return { head: raw, prefix: null };
  }
  // "e-mail" → `e & mail:*`; each piece is a plain lexeme.
  const prefix = pieces
    .map((piece, i) => (i === pieces.length - 1 ? `${piece}:*` : piece))
    .join(" & ");
  return { head: raw.slice(0, raw.length - word.length), prefix };
};

const searchQuery = (config: SQL, raw: string): SQL => {
  const { head, prefix } = prefixSearchParts(raw);
  if (prefix === null) {
    return sql`websearch_to_tsquery(${config}, ${raw})`;
  }
  // An empty `head` is an empty tsquery, which `&&` drops. The last word as
  // websearch reads it is kept too, so an exact match never ranks lower.
  const word = raw.slice(head.length);
  return sql`(websearch_to_tsquery(${config}, ${head}) && (websearch_to_tsquery(${config}, ${word}) || to_tsquery(${config}, ${prefix})))`;
};

/**
 * Matches in the titles and message text of chats the viewer can read,
 * best first (`websearch_to_tsquery`, so quotes and `-word` work, with the
 * last word also matching as a prefix: `prefixSearchParts`). Title matches
 * rank double. Ranked results can't be keyset-paged, so the cursor is an
 * offset.
 */
export const searchConversations = async (
  db: Db,
  viewer: Viewer,
  input: SearchConversationsInput
): AsyncResult<Page<SearchHit>, InvalidCursorError> => {
  const offset = offsetOf(input.cursor);
  if (!offset.ok) {
    return offset;
  }
  const config = sql.raw(`'${TEXT_SEARCH_CONFIG}'`);
  const query = searchQuery(config, input.query);
  const scope = and(
    inHistory,
    canRead(viewer),
    isSetFilter(conversation.archivedAt, input.archived),
    input.contextType === undefined
      ? undefined
      : eq(conversation.contextType, input.contextType)
  );
  const rows = rowsOf<{
    conversation_id: ConversationId;
    headline: string;
    message_id: MessageId | null;
    rank: number;
    role: MessageRole | null;
    title: string | null;
    updated_at: Date | string;
  }>(
    await db.execute(sql`
      select * from (
        select ${conversation.id} as conversation_id, null::uuid as message_id, null::text as role,
          ts_headline(${config}, coalesce(${conversation.title}, ''), ${query}, ${HEADLINE_OPTIONS}) as headline,
          ts_rank(${conversation.titleSearch}, ${query}) * 2 as rank,
          ${conversation.title} as title, ${conversation.updatedAt} as updated_at
        from ${conversation}
        where ${conversation.titleSearch} @@ ${query} and ${scope}
        union all
        select ${conversation.id}, ${message.id}, ${message.role},
          ts_headline(${config}, array_to_string(array(select jsonb_array_elements_text(jsonb_path_query_array(${message.parts}, '$[*] ? (@.type == "text").text'))), ' '), ${query}, ${HEADLINE_OPTIONS}),
          ts_rank(${message.textSearch}, ${query}),
          ${conversation.title}, ${conversation.updatedAt}
        from ${message} join ${conversation} on ${conversation.id} = ${message.conversationId}
        where ${message.textSearch} @@ ${query} and ${scope}
      ) hits
      order by rank desc, updated_at desc, message_id nulls first
      limit ${input.limit + 1} offset ${offset.value}
    `)
  );
  const items = rows.slice(0, input.limit).map(
    (row): SearchHit => ({
      conversationId: row.conversation_id,
      ...parseHeadline(row.headline),
      messageId: row.message_id,
      rank: Number(row.rank),
      role: row.role,
      title: row.title,
      updatedAt: new Date(row.updated_at).toISOString(),
    })
  );
  return ok({
    items,
    nextCursor:
      rows.length > input.limit
        ? Buffer.from(String(offset.value + input.limit)).toString("base64url")
        : null,
  });
};

// --- Added for the participants route (ticket 014) ---

export interface ParticipantRow {
  readonly activeLeafId: MessageId | null;
  readonly email: string;
  readonly followingUserId: UserId | null;
  readonly image: string | null;
  readonly lastReadAt: Date | null;
  readonly name: string;
  /** From ownership and grants held by the user directly; team and org grants are 012's to fold in. */
  readonly permission: ConversationPermission;
  readonly userId: UserId;
}

/** Everyone with per-user state in a conversation, oldest first. */
export const listParticipants = async (
  db: Db,
  conversationId: ConversationId
): Promise<ParticipantRow[]> => {
  const userGrant = (level: string) =>
    sql`exists (select 1 from ${resourceGrant} where ${resourceGrant.resourceType} = 'conversation' and ${resourceGrant.resourceId} = ${conversation.id} and ${resourceGrant.principalType} = 'user' and ${resourceGrant.principalId} = ${user.id} and ${resourceGrant.permission} = ${level})`;
  return await db
    .select({
      activeLeafId: conversationParticipant.activeLeafId,
      email: user.email,
      followingUserId: conversationParticipant.followingUserId,
      image: user.image,
      lastReadAt: conversationParticipant.lastReadAt,
      name: user.name,
      permission: sql<ConversationPermission>`case
        when ${conversation.ownerId} = ${user.id} then 'owner'
        when ${userGrant("editor")} then 'editor'
        else 'viewer'
      end`,
      userId: user.id,
    })
    .from(conversationParticipant)
    .innerJoin(
      conversation,
      eq(conversation.id, conversationParticipant.conversationId)
    )
    .innerJoin(user, eq(user.id, conversationParticipant.userId))
    .where(eq(conversationParticipant.conversationId, conversationId))
    .orderBy(asc(conversationParticipant.createdAt));
};
