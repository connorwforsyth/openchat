import {
  conversation as contractConversation,
  sandbox as contractSandbox,
  fixtureId,
  me,
  teamPlatform,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import type { MessageId } from "@workspace/contract/schemas/common";
import type {
  Conversation,
  Participant,
} from "@workspace/contract/schemas/conversations";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { PendingApproval } from "@workspace/contract/schemas/runs";

import { MEMORY_TOOL_NAME } from "./model/parts";

// A worked conversation for the demo page and component tests, built on the
// contract's fixtures: two branch points, every part type the view renders,
// an approval with a two-hunk edit, a memory update and versioned
// artifacts. Sample content, not UI copy, so it isn't localised.

const conversationId = contractConversation.id;
const minute = (n: number): string =>
  new Date(Date.UTC(2026, 8, 27, 9, n)).toISOString();

const id = (n: number): MessageId => fixtureId("message", 100 + n);

const base = {
  agent: null,
  conversationId,
  partsVersion: 1 as const,
  runId: null,
  status: "complete" as const,
  usage: null,
};

const user = (
  n: number,
  parentId: MessageId | null,
  text: string
): Message => ({
  ...base,
  authorId: userAda.id,
  createdAt: minute(n),
  id: id(n),
  model: null,
  parentId,
  parts: [{ text, type: "text" }],
  role: "user",
});

const assistant = (
  n: number,
  parentId: MessageId,
  parts: MessagePart[],
  extra: Partial<Message> = {}
): Message => ({
  ...base,
  agent: {
    id: fixtureId("libraryItem", 1),
    versionId: fixtureId("libraryVersion", 2),
  },
  authorId: null,
  createdAt: minute(n),
  id: id(n),
  model: "anthropic:claude-opus-5-5",
  parentId,
  parts,
  role: "assistant",
  ...extra,
});

export const artifactPlan: Artifact = {
  conversationId,
  createdAt: minute(8),
  id: fixtureId("artifact", 11),
  kind: "markdown",
  latestVersionId: fixtureId("artifactVersion", 12),
  messageId: id(8),
  title: "search-migration-plan.md",
  updatedAt: minute(12),
};

export const artifactPage: Artifact = {
  conversationId,
  createdAt: minute(4),
  id: fixtureId("artifact", 21),
  kind: "html",
  latestVersionId: fixtureId("artifactVersion", 21),
  messageId: id(4),
  title: "benchmark.html",
  updatedAt: minute(4),
};

export const artifactVersions: Readonly<
  Record<string, readonly ArtifactVersion[]>
> = {
  [artifactPage.id]: [
    {
      artifactId: artifactPage.id,
      content:
        "<!doctype html><html><body style=\"font-family:system-ui;padding:1rem\"><h1>Search benchmark</h1><table><tr><th>Engine</th><th>p95</th></tr><tr><td>Postgres FTS</td><td>38 ms</td></tr><tr><td>Meilisearch</td><td>6 ms</td></tr></table><script>document.body.append(' Rendered at ' + new Date().toLocaleTimeString())</script></body></html>",
      createdAt: minute(4),
      id: fixtureId("artifactVersion", 21),
      language: null,
      messageId: id(4),
      number: 1,
    },
  ],
  [artifactPlan.id]: [
    {
      artifactId: artifactPlan.id,
      content:
        "# Search migration\n\n## Phase 1 (Q1)\n\n- `pg_trgm` on `subject`\n- Weighted `ts_rank_cd`\n\n## Phase 2 (Q2)\n\n- Outbox to Meilisearch worker\n- Search box behind a flag\n",
      createdAt: minute(8),
      id: fixtureId("artifactVersion", 11),
      language: null,
      messageId: id(8),
      number: 1,
    },
    {
      artifactId: artifactPlan.id,
      content:
        "# Search migration\n\n## Phase 1 (Q1)\n\n- `pg_trgm` on `subject`\n- Weighted `ts_rank_cd` (A: subject, B: body)\n\n## Phase 2 (Q2)\n\n- Outbox to Meilisearch worker, batched every 2 s\n- Search box behind a flag\n- Reindex job for backfills\n",
      createdAt: minute(12),
      id: fixtureId("artifactVersion", 12),
      language: null,
      messageId: id(12),
      number: 2,
    },
  ],
};

export const chatArtifacts: readonly Artifact[] = [artifactPlan, artifactPage];

/** The proposed edit waiting on review in the last turn. */
export const pendingEdit: PendingApproval = {
  edits: [
    {
      hunks: [
        { hunkId: "h1", newLines: 5, newStart: 3, oldLines: 4, oldStart: 3 },
        { hunkId: "h2", newLines: 3, newStart: 9, oldLines: 3, oldStart: 8 },
      ],
      patch: [
        "@@ -3,4 +3,5 @@",
        " export async function syncBatch(batch: Ticket[]) {",
        "   const docs = batch.map(toDocument);",
        '-  await meili.index("tickets").addDocuments(docs);',
        '+  await withRetry(() => meili.index("tickets").addDocuments(docs));',
        '+  metrics.increment("search.sync.batches");',
        " }",
        "@@ -8,3 +9,3 @@",
        " export function toDocument(ticket: Ticket) {",
        "-  return { id: ticket.id, subject: ticket.subject };",
        "+  return { body: ticket.body, id: ticket.id, subject: ticket.subject };",
        " }",
        "",
      ].join("\n"),
      path: "src/search/sync-worker.ts",
    },
  ],
  input: { path: "src/search/sync-worker.ts" },
  requestedAt: minute(14),
  toolCallId: "call_edit_1",
  toolName: "edit",
};

const u1 = user(
  1,
  null,
  "We're on Postgres 16 and search over ~2M support tickets is getting slow. Should we stick with Postgres full-text search or move to Meilisearch?"
);
const a2 = assistant(2, u1.id, [
  { type: "step-start" },
  {
    text: "Slow could mean latency or relevance. Check which before adding a datastore.",
    type: "reasoning",
  },
  {
    text: "Both can work at 2M rows. The real question is what *slow* means for you: raw latency, or relevance (typos, prefixes, ranking).\n\n| | Postgres FTS | Meilisearch |\n| --- | --- | --- |\n| Typo tolerance | Only with `pg_trgm` | Built in |\n| Ops cost | None (same DB) | Another service |\n| Consistency | Transactional | Eventually consistent |\n\n```sql\nCREATE INDEX tickets_search_idx ON tickets USING gin (search);\n```",
    type: "text",
  },
  {
    id: "src-pg",
    source: {
      kind: "url",
      title: "PostgreSQL: Full Text Search",
      url: "https://www.postgresql.org/docs/current/textsearch.html",
    },
    type: "source",
  },
  {
    id: "src-meili",
    source: {
      kind: "url",
      title: "Meilisearch documentation",
      url: "https://www.meilisearch.com/docs",
    },
    type: "source",
  },
]);
const u3 = user(
  3,
  a2.id,
  "We already have that index. Benchmark both against the staging snapshot in the sandbox?"
);
const a4 = assistant(4, u3.id, [
  {
    approval: { state: "not-required" },
    input: {
      command: "bun bench/search.ts --queries logs/search.jsonl --n 500",
    },
    toolCallId: "call_bench",
    toolName: "sandbox_exec",
    type: "tool-call",
  },
  {
    output: {
      status: "success",
      value:
        "engine        p50   p95   typo_hit\npostgres_fts  11ms  38ms  0.41\nmeilisearch    2ms   6ms  0.94",
    },
    toolCallId: "call_bench",
    toolName: "sandbox_exec",
    type: "tool-result",
  },
  {
    text: "Postgres is fast enough (p95 38 ms against a 50 ms budget); the gap is relevance on misspelled queries: 41% of typos matched versus 94%.",
    type: "text",
  },
  {
    artifactId: artifactPage.id,
    kind: "html",
    title: artifactPage.title,
    type: "artifact-ref",
    versionId: fixtureId("artifactVersion", 21),
  },
]);
const u5 = user(
  5,
  a4.id,
  "Given those numbers, what would you recommend for the next two quarters? I use pnpm, by the way."
);
// Branch point: three answers to u5.
const a6 = assistant(6, u5.id, [
  {
    text: "**Stay on Postgres and tune it.** Your p95 is already inside budget, so fix ranking: add `pg_trgm` on `subject` and weight `ts_rank_cd`. Revisit if the corpus passes ~10M rows.",
    type: "text",
  },
]);
const a8 = assistant(8, u5.id, [
  {
    text: "**Hybrid, in two steps.** Keep filters and permissions on Postgres and use Meilisearch only for the free-text box. Relevance is roughly $$\\text{score} = w_A \\cdot \\text{subject} + w_B \\cdot \\text{body}$$ with $$w_A > w_B$$.",
    type: "text",
  },
  {
    artifactId: artifactPlan.id,
    kind: "markdown",
    title: artifactPlan.title,
    type: "artifact-ref",
    versionId: fixtureId("artifactVersion", 11),
  },
  {
    approval: { state: "not-required" },
    input: {
      patches: [{ op: "append", text: "- Uses pnpm" }],
      summary: "Uses pnpm",
    },
    toolCallId: "call_memory",
    toolName: MEMORY_TOOL_NAME,
    type: "tool-call",
  },
  {
    output: {
      status: "success",
      value: {
        number: 3,
        previousVersionId: fixtureId("memoryVersion", 2),
        status: "applied",
        summary: "Uses pnpm",
        versionId: fixtureId("memoryVersion", 3),
      },
    },
    toolCallId: "call_memory",
    toolName: MEMORY_TOOL_NAME,
    type: "tool-result",
  },
  {
    text: "I'll remember that you use pnpm.",
    type: "text",
  },
]);
const a7 = assistant(
  7,
  u5.id,
  [{ text: "**Move everything to Meilisearch", type: "text" }],
  { status: "partial" }
);
const u9 = user(
  9,
  a8.id,
  "Good. Add a retry wrapper around the Meilisearch sync in the worker."
);
// Branch point: the user edited u9.
const u10 = user(
  10,
  a8.id,
  "Good. Add a retry wrapper around the Meilisearch sync and index ticket bodies too."
);
const a11 = assistant(11, u9.id, [
  { text: "Done: the sync retries three times with backoff.", type: "text" },
]);
const a12 = assistant(12, u10.id, [
  {
    text: "Here's the change. It wraps the upload in `withRetry` and adds the body to each document; review it hunk by hunk.",
    type: "text",
  },
  {
    approval: { requestedAt: minute(14), state: "pending" },
    input: { path: "src/search/sync-worker.ts" },
    toolCallId: pendingEdit.toolCallId,
    toolName: "edit",
    type: "tool-call",
  },
]);

/** Every message in the tree, in creation order. */
export const treeMessages: readonly Message[] = [
  u1,
  a2,
  u3,
  a4,
  u5,
  a6,
  a7,
  a8,
  u9,
  u10,
  a11,
  a12,
];

/** The leaf the demo opens on: the edited branch with the pending approval. */
export const initialLeafId: MessageId = a12.id;

export const participants: readonly Participant[] = [
  {
    permission: "owner",
    state: contractConversation.myState,
    user: userAda,
  },
  {
    permission: "editor",
    state: { ...contractConversation.myState, userId: userBo.id },
    user: userBo,
  },
];

export const chatSandbox = contractSandbox;
export const chatMe = me;
export const chatContext = { id: teamPlatform.id, type: "team" as const };

const titles = [
  "Postgres full-text search vs Meilisearch",
  "Review PR 482: S3 upload retries",
  "Platform offsite agenda",
  "Incident summary: API latency spike",
  "Semver regex with pre-release tags",
  "Worker OOMKilled on Mondays",
  "TypeScript satisfies vs annotations",
  "UUIDv4 to v7 migration plan",
  "Fairer on-call rotation",
  "Three days in Lisbon",
  "RFC: Jenkins to GitHub Actions",
];
// Hours ago for each chat: today, yesterday, the past week and older.
const ages = [0.05, 1, 3, 5, 26, 30, 72, 96, 140, 400, 700];

/** Sidebar chats relative to `now`, the first being the open conversation. */
export const sidebarChats = (now: Date): readonly Conversation[] =>
  titles.map((title, index) => {
    const at = new Date(
      now.getTime() - (ages[index] ?? 0) * 60 * 60 * 1000
    ).toISOString();
    return {
      ...contractConversation,
      createdAt: at,
      id: index === 0 ? conversationId : fixtureId("conversation", 200 + index),
      lastMessageAt: at,
      pinned: index === 1,
      title,
      updatedAt: at,
    };
  });
