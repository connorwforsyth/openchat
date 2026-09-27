// Sample data for the app-shell prototype (ticket 009). Content, not UI copy:
// it stands in for what users type and models return, so it isn't localised.

export type ContextId = "personal" | "engineering" | "platform";

export interface ChatContextOption {
  readonly depth: number;
  readonly id: ContextId;
  readonly label: string;
  /** The full path, for breadcrumbs: "Engineering › Platform". */
  readonly path: string;
}

export const org = { name: "Northwind Labs" } as const;

const personalContext: ChatContextOption = {
  depth: 0,
  id: "personal",
  label: "Personal",
  path: "Personal",
};

export const contexts: readonly ChatContextOption[] = [
  personalContext,
  { depth: 0, id: "engineering", label: "Engineering", path: "Engineering" },
  {
    depth: 1,
    id: "platform",
    label: "Platform",
    path: "Engineering › Platform",
  },
];

export const contextById = (id: ContextId): ChatContextOption =>
  contexts.find((context) => context.id === id) ?? personalContext;

export const currentUser = {
  email: "maya.chen@northwind.dev",
  initials: "MC",
  name: "Maya Chen",
  plan: "Northwind Labs · Member",
} as const;

export interface Participant {
  readonly initials: string;
  readonly name: string;
  readonly role: "owner" | "editor" | "viewer";
}

export const initialParticipants: readonly Participant[] = [
  { initials: "MC", name: "Maya Chen", role: "owner" },
  { initials: "DP", name: "Dev Patel", role: "editor" },
];

export type DateGroup = "Today" | "Yesterday" | "Previous 7 days" | "Older";

export const dateGroups: readonly DateGroup[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older",
];

export interface ToolCall {
  readonly input: Record<string, string>;
  readonly name: string;
  readonly output: string;
}

export interface ChatMessage {
  /** Alternative answers for this turn; `text` is unused when present. */
  readonly branches?: readonly string[];
  readonly id: string;
  readonly reasoning?: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly tool?: ToolCall;
}

export interface Chat {
  readonly agent?: string;
  readonly context: ContextId;
  readonly group: DateGroup;
  readonly id: string;
  readonly messages: readonly ChatMessage[];
  readonly pinned?: boolean;
  readonly title: string;
  readonly updated: string;
}

const pair = (
  id: string,
  question: string,
  answer: string
): readonly ChatMessage[] => [
  { id: `${id}-u1`, role: "user", text: question },
  { id: `${id}-a1`, role: "assistant", text: answer },
];

export const CURRENT_CHAT_ID = "c-postgres-fts";

export const currentChatBranches: readonly string[] = [
  `**Stay on Postgres and tune it.** Your p95 of 38 ms on 2.1M rows is already inside the 50 ms budget, so the pain is in ranking quality, not speed.

1. Add a \`pg_trgm\` index on \`subject\` for typo tolerance on short queries.
2. Move ranking to \`ts_rank_cd\` with weights (\`A\` subject, \`B\` body).
3. Revisit in Q3 if the corpus passes ~10M rows.

One less service to run, back up and secure. You give up instant typo-tolerant search-as-you-type.`,
  `**Move the search box to Meilisearch; keep Postgres as the source of truth.** The benchmark shows Meilisearch at 6 ms p95 with typo tolerance out of the box, which is what support agents keep asking for.

\`\`\`ts
// Outbox → Meilisearch, batched every 2 s
for await (const batch of outbox.stream({ maxWait: 2_000 })) {
  await meili.index("tickets").addDocuments(batch.map(toDocument));
  await outbox.ack(batch);
}
\`\`\`

Budget one sprint for the sync worker and a reindex job. The cost is a second datastore to run and a few seconds of index lag.`,
  `**Hybrid, in two steps.** Keep filters, permissions and exports on Postgres (it already enforces row-level security) and use Meilisearch only for the free-text box.

- **Q1:** ship \`pg_trgm\` tuning; it's a day of work and buys headroom.
- **Q2:** add Meilisearch behind a flag for the ticket search box only, fed by the outbox.

This keeps permission checks in one place, which matters once team-shared chats and audit are on.`,
];

const benchmarkTool: ToolCall = {
  input: {
    command: "bun bench/search.ts --queries logs/search-2026-09.jsonl --n 500",
    cwd: "/workspace",
  },
  name: "sandbox.exec",
  output: `engine        p50     p95     typo_hit
postgres_fts  11ms    38ms    0.41
meilisearch    2ms     6ms    0.94
500 queries · 2,104,388 docs · 41.2s`,
};

const currentChatReasoning = `The benchmark says Postgres is inside the latency budget, so speed alone doesn't justify a second datastore.

The complaint is misspelled queries. That points to typo tolerance, which Meilisearch gives for free and Postgres only approximates with \`pg_trgm\`.

Row-level security lives in Postgres today, so anything moved out needs its own permission filter.`;

const currentChatMessages: readonly ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    text: "We're on Postgres 16 and search over ~2M support tickets is getting slow. Should we stick with Postgres full-text search or move to Meilisearch?",
  },
  {
    id: "m2",
    role: "assistant",
    text: `Both can work at 2M rows. The real question is what "slow" means for you: raw latency, or relevance (typos, prefixes, ranking).

| | Postgres FTS | Meilisearch |
| --- | --- | --- |
| Typo tolerance | Only with \`pg_trgm\` | Built in |
| Ops cost | None (same DB) | Another service |
| Consistency | Transactional | Eventually consistent |

If you haven't yet, start with a stored \`tsvector\` column and a GIN index:

\`\`\`sql
ALTER TABLE tickets
  ADD COLUMN search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

CREATE INDEX tickets_search_idx ON tickets USING gin (search);
\`\`\``,
  },
  {
    id: "m3",
    role: "user",
    text: "We already have that index. Can you benchmark both against the staging snapshot in the sandbox?",
  },
  {
    id: "m4",
    role: "assistant",
    text: `I ran 500 real queries from last week's search log against both, warm cache, on the sandbox's 4 vCPU box.

| Engine | p50 | p95 | Typos matched |
| --- | --- | --- | --- |
| Postgres FTS | 11 ms | 38 ms | 41% |
| Meilisearch 1.12 | 2 ms | 6 ms | 94% |

Postgres is fast enough; the gap is relevance on misspelled queries.`,
    tool: benchmarkTool,
  },
  {
    id: "m5",
    role: "user",
    text: "Given those numbers, what would you recommend for the next two quarters?",
  },
  {
    branches: currentChatBranches,
    id: "m6",
    reasoning: currentChatReasoning,
    role: "assistant",
    text: "",
  },
];

export const initialChats: readonly Chat[] = [
  {
    context: "platform",
    group: "Today",
    id: CURRENT_CHAT_ID,
    messages: currentChatMessages,
    title: "Postgres full-text search vs Meilisearch",
    updated: "2m ago",
  },
  {
    agent: "Code Reviewer",
    context: "platform",
    group: "Today",
    id: "c-pr-review",
    messages: pair(
      "c-pr-review",
      "Review PR 482: the retry wrapper around the S3 upload client.",
      "The backoff looks right, but `retry()` swallows the final error: callers see `undefined` instead of the S3 exception. Re-throw after the last attempt."
    ),
    pinned: true,
    title: "Review PR 482: S3 upload retries",
    updated: "1h ago",
  },
  {
    context: "personal",
    group: "Today",
    id: "c-offsite",
    messages: pair(
      "c-offsite",
      "Draft an agenda for a half-day platform offsite, 8 people.",
      "09:30 Wins and misses (30 min) · 10:00 Reliability review (60 min) · 11:15 Q4 bets (75 min) · 12:30 Lunch and open questions."
    ),
    title: "Platform offsite agenda",
    updated: "3h ago",
  },
  {
    context: "engineering",
    group: "Today",
    id: "c-incident",
    messages: pair(
      "c-incident",
      "Summarise the 14:05 API latency incident from the Slack thread.",
      "A connection-pool exhaustion on `api-2` after the 13:50 deploy raised p99 to 4.2 s for 18 minutes. Rolled back at 14:23."
    ),
    title: "Incident summary: API latency spike",
    updated: "5h ago",
  },
  {
    context: "personal",
    group: "Yesterday",
    id: "c-regex",
    messages: pair(
      "c-regex",
      "Regex to match semver with optional pre-release tags?",
      "`^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([\\w.-]+))?(?:\\+([\\w.-]+))?$` covers `1.2.3`, `1.2.3-rc.1` and build metadata."
    ),
    title: "Semver regex with pre-release tags",
    updated: "Yesterday",
  },
  {
    context: "platform",
    group: "Yesterday",
    id: "c-k8s",
    messages: pair(
      "c-k8s",
      "Why does our worker pod get OOMKilled only on Mondays?",
      "Monday's backlog makes the batch size hit the 512 MiB limit. Cap the batch at 200 or raise the limit to 1 GiB."
    ),
    title: "Worker OOMKilled on Mondays",
    updated: "Yesterday",
  },
  {
    agent: "Release Notes Writer",
    context: "engineering",
    group: "Yesterday",
    id: "c-release",
    messages: pair(
      "c-release",
      "Write release notes for v2.14 from these merged PRs.",
      "**v2.14** — Faster ticket search, bulk assign from the inbox, and a fix for duplicated email notifications."
    ),
    title: "Release notes for v2.14",
    updated: "Yesterday",
  },
  {
    context: "personal",
    group: "Previous 7 days",
    id: "c-ts-generics",
    messages: pair(
      "c-ts-generics",
      "Explain `satisfies` vs a type annotation in TypeScript.",
      "An annotation widens the value to the type; `satisfies` checks it against the type but keeps the narrower inferred type."
    ),
    title: "TypeScript satisfies vs annotations",
    updated: "Mon",
  },
  {
    context: "platform",
    group: "Previous 7 days",
    id: "c-migration",
    messages: pair(
      "c-migration",
      "Plan a zero-downtime migration from UUIDv4 to UUIDv7 ids.",
      "Add a `v7` column, backfill in batches, dual-write, switch reads behind a flag, then drop the old column after a week."
    ),
    title: "UUIDv4 → v7 migration plan",
    updated: "Mon",
  },
  {
    context: "engineering",
    group: "Previous 7 days",
    id: "c-oncall",
    messages: pair(
      "c-oncall",
      "Suggest a fairer on-call rotation for 6 engineers across 2 time zones.",
      "Follow-the-sun: 12-hour shifts split by region, weekly rotation, and a weekend buddy so nobody is alone on a Saturday."
    ),
    title: "Fairer on-call rotation",
    updated: "Sun",
  },
  {
    context: "personal",
    group: "Previous 7 days",
    id: "c-bread",
    messages: pair(
      "c-bread",
      "My sourdough is dense. 75% hydration, 4 h bulk at 21 °C.",
      "At 21 °C, 4 h is short for bulk. Aim for a 50–75% rise: closer to 6–7 h, or warm the dough to 24 °C."
    ),
    title: "Dense sourdough troubleshooting",
    updated: "Sat",
  },
  {
    agent: "SQL Tutor",
    context: "personal",
    group: "Previous 7 days",
    id: "c-window",
    messages: pair(
      "c-window",
      "When should I use a window function instead of GROUP BY?",
      "When you need the aggregate next to each row — running totals, ranks, 'previous value' — without collapsing the rows."
    ),
    title: "Window functions vs GROUP BY",
    updated: "Fri",
  },
  {
    context: "platform",
    group: "Previous 7 days",
    id: "c-otel",
    messages: pair(
      "c-otel",
      "How do we propagate trace context through our Redis job queue?",
      "Inject the W3C `traceparent` into the job payload on enqueue and extract it in the worker before starting the span."
    ),
    title: "Trace context through Redis jobs",
    updated: "Thu",
  },
  {
    context: "personal",
    group: "Older",
    id: "c-lisbon",
    messages: pair(
      "c-lisbon",
      "Three days in Lisbon in November — what should I not miss?",
      "Alfama at dusk, the LX Factory on Sunday, and a day trip to Sintra (go early, book Pena Palace ahead)."
    ),
    title: "Three days in Lisbon",
    updated: "Aug 28",
  },
  {
    context: "engineering",
    group: "Older",
    id: "c-rfc",
    messages: pair(
      "c-rfc",
      "Tighten the RFC for moving CI from Jenkins to GitHub Actions.",
      "Lead with the cost and flake numbers, move the runner-security section up, and cut the history of the Jenkins setup."
    ),
    title: "RFC: Jenkins → GitHub Actions",
    updated: "Aug 21",
  },
  {
    context: "personal",
    group: "Older",
    id: "c-interview",
    messages: pair(
      "c-interview",
      "Give me a system design question for a senior backend interview.",
      "Design a rate limiter shared by 40 API servers: per-key limits, bursts, and graceful degradation when Redis is down."
    ),
    title: "Senior backend interview question",
    updated: "Aug 14",
  },
  {
    context: "platform",
    group: "Older",
    id: "c-cdn",
    messages: pair(
      "c-cdn",
      "Our CDN hit ratio dropped from 92% to 71% after the redesign. Why?",
      "The new build adds a query-string cache buster to every asset. Hash the filename instead and strip the query."
    ),
    title: "CDN hit ratio drop after redesign",
    updated: "Aug 9",
  },
  {
    context: "personal",
    group: "Older",
    id: "c-budget",
    messages: pair(
      "c-budget",
      "Build a simple monthly budget template with savings goals.",
      "Four blocks: fixed costs, variable spend, savings goals (with target dates) and a buffer. Review on the 1st."
    ),
    title: "Monthly budget template",
    updated: "Jul 30",
  },
  {
    context: "engineering",
    group: "Older",
    id: "c-postmortem",
    messages: pair(
      "c-postmortem",
      "Turn these notes into a blameless postmortem.",
      "Summary, impact, timeline, contributing factors, what went well, and four action items with owners and dates."
    ),
    title: "Blameless postmortem: queue backlog",
    updated: "Jul 22",
  },
  {
    context: "personal",
    group: "Older",
    id: "c-rust",
    messages: pair(
      "c-rust",
      "Why does the borrow checker reject this closure?",
      "The closure captures `self` mutably while `items` is still borrowed. Clone the ids first or split the borrow."
    ),
    title: "Borrow checker vs a closure",
    updated: "Jul 11",
  },
];

export interface LibraryItem {
  readonly description: string;
  readonly id: string;
  readonly kind: "agent" | "prompt" | "skill";
  readonly name: string;
  readonly owner: string;
}

export const library: readonly LibraryItem[] = [
  {
    description: "Reviews diffs against the team's style guide",
    id: "l-reviewer",
    kind: "agent",
    name: "Code Reviewer",
    owner: "Engineering › Platform",
  },
  {
    description: "Explains queries step by step, with EXPLAIN plans",
    id: "l-sql",
    kind: "agent",
    name: "SQL Tutor",
    owner: "Personal",
  },
  {
    description: "Turns merged PRs into customer-facing notes",
    id: "l-release",
    kind: "agent",
    name: "Release Notes Writer",
    owner: "Engineering",
  },
  {
    description: "Drafts a timeline and postmortem from a Slack thread",
    id: "l-incident",
    kind: "agent",
    name: "Incident Scribe",
    owner: "Engineering",
  },
  {
    description: "Summarise a pull request for a reviewer in a hurry",
    id: "l-pr-summary",
    kind: "prompt",
    name: "Summarise a PR",
    owner: "Personal",
  },
  {
    description: "Walk me through this part of the codebase like I'm new",
    id: "l-onboard",
    kind: "prompt",
    name: "Explain like I'm new here",
    owner: "Engineering",
  },
  {
    description: "Phased plan with rollback steps and a risk table",
    id: "l-migration",
    kind: "prompt",
    name: "Write a migration plan",
    owner: "Engineering › Platform",
  },
  {
    description: "Runs k6 against a staging URL and charts the results",
    id: "l-loadtest",
    kind: "skill",
    name: "Load test",
    owner: "Engineering › Platform",
  },
];

export const sandbox = {
  files: [
    { name: "bench/search.ts", size: "3.1 KB" },
    { name: "bench/fts.sql", size: "842 B" },
    { name: "logs/search-2026-09.jsonl", size: "1.4 MB" },
    { name: "results/benchmark.csv", size: "12 KB" },
  ],
  log: [
    { kind: "cmd", text: "docker compose up -d meilisearch" },
    { kind: "out", text: "✔ Container meilisearch  Started   1.8s" },
    { kind: "cmd", text: "bun bench/load-snapshot.ts --from s3://staging" },
    { kind: "out", text: "Indexed 2,104,388 tickets in 3m 12s" },
    {
      kind: "cmd",
      text: "bun bench/search.ts --queries logs/search-2026-09.jsonl --n 500",
    },
    { kind: "out", text: "postgres_fts  p50 11ms  p95 38ms  typo 0.41" },
    { kind: "out", text: "meilisearch   p50  2ms  p95  6ms  typo 0.94" },
    { kind: "out", text: "Wrote results/benchmark.csv" },
  ],
  runtime: "just-bash",
} as const;

export interface Artifact {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly preview: string;
}

export const artifacts: readonly Artifact[] = [
  {
    id: "a-results",
    kind: "Table",
    name: "benchmark-results.md",
    preview:
      "| Engine | p50 | p95 | Typos |\n| --- | --- | --- | --- |\n| Postgres FTS | 11 ms | 38 ms | 41% |\n| Meilisearch | 2 ms | 6 ms | 94% |",
  },
  {
    id: "a-plan",
    kind: "Document",
    name: "search-migration-plan.md",
    preview:
      "## Phase 1 (Q1)\n- pg_trgm on subject\n- weighted ts_rank_cd\n\n## Phase 2 (Q2)\n- Outbox → Meilisearch worker\n- Search box behind a flag",
  },
  {
    id: "a-compose",
    kind: "Code",
    name: "docker-compose.meili.yml",
    preview:
      "services:\n  meilisearch:\n    image: getmeili/meilisearch:v1.12\n    ports: ['7700:7700']\n    volumes: ['meili:/meili_data']",
  },
];

export const models = [
  { label: "Auto", value: "auto" },
  { label: "Claude Sonnet 4.5", value: "sonnet" },
  { label: "Qwen 2.5 Coder (Ollama)", value: "qwen" },
] as const;
