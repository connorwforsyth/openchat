import { type Id, idSchema } from "@workspace/shared/ids";

import type { Conversation } from "./schemas/conversations";
import type { FileRecord } from "./schemas/files";
import type { ResourceGrant, ShareLink } from "./schemas/grants";
import type {
  AgentDefinition,
  LibraryItemDetail,
  LibraryVersion,
} from "./schemas/library";
import type {
  LlmProxyRequest,
  LlmProxyResponse,
  LlmStreamPart,
} from "./schemas/llm";
import type { MessagePart } from "./schemas/message-parts";
import type { BranchPath, Message } from "./schemas/messages";
import type { Me, PublicConfig } from "./schemas/meta";
import type { ModelOption } from "./schemas/models";
import type { Run } from "./schemas/runs";
import type { SandboxRecord } from "./schemas/sandbox";
import type { Org, Team, UserSummary } from "./schemas/tenancy";

// Valid sample data for every major contract type, with fixed ids and times so
// snapshots are stable. The contract's own tests parse all of it; UI
// workstreams (chat-ui, composer) can render it before the server exists.

/** A fixed, valid UUIDv7 for fixtures: `n` picks which one. */
export const fixtureId = <K extends string>(kind: K, n: number): Id<K> =>
  idSchema(kind).parse(
    `0192a000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
  );

export const fixtureTime = (minute = 0): string =>
  new Date(Date.UTC(2026, 8, 26, 9, minute)).toISOString();

export const userAda: UserSummary = {
  email: "ada@example.test",
  id: fixtureId("user", 1),
  image: null,
  name: "Ada",
};

export const userBo: UserSummary = {
  email: "bo@example.test",
  id: fixtureId("user", 2),
  image: null,
  name: "Bo",
};

export const org: Org = {
  createdAt: fixtureTime(),
  id: fixtureId("org", 1),
  isPersonal: false,
  logoUrl: null,
  myRole: "owner",
  name: "Example Co",
  slug: "example-co",
};

export const teamEngineering: Team = {
  createdAt: fixtureTime(),
  id: fixtureId("team", 1),
  name: "Engineering",
  orgId: org.id,
  parentId: null,
};

export const teamPlatform: Team = {
  createdAt: fixtureTime(1),
  id: fixtureId("team", 2),
  name: "Platform",
  orgId: org.id,
  parentId: teamEngineering.id,
};

export const conversation: Conversation = {
  archived: false,
  context: { id: teamPlatform.id, type: "team" },
  contextLocked: true,
  createdAt: fixtureTime(),
  defaultTarget: { model: "strong", type: "model" },
  id: fixtureId("conversation", 1),
  lastMessageAt: fixtureTime(3),
  mode: "code",
  myPermission: "owner",
  myState: {
    activeLeafId: fixtureId("message", 4),
    followingUserId: null,
    lastReadAt: fixtureTime(3),
    userId: userAda.id,
  },
  ownerId: userAda.id,
  pinned: false,
  title: "Refactor the billing module",
  updatedAt: fixtureTime(3),
  visibility: "shared",
};

/** One of every part type, in a plausible order. */
export const allMessageParts: MessagePart[] = [
  { type: "step-start" },
  { text: "The user wants a smaller diff.", type: "reasoning" },
  { text: "Here's the plan.", type: "text" },
  {
    filename: "invoice.pdf",
    mediaType: "application/pdf",
    source: { fileId: fixtureId("file", 1), kind: "file" },
    type: "file",
  },
  {
    id: "src-1",
    source: {
      kind: "url",
      title: "Billing docs",
      url: "https://docs.example.test/billing",
    },
    type: "source",
  },
  {
    approval: {
      decidedAt: fixtureTime(2),
      decidedBy: userAda.id,
      decision: {
        comments: [],
        decision: "review",
        hunks: [
          { decision: "accept", hunkId: "h1" },
          { comment: "Keep the old name", decision: "reject", hunkId: "h2" },
        ],
      },
      state: "decided",
    },
    input: { content: "…", path: "src/billing.ts" },
    toolCallId: "call_1",
    toolName: "edit",
    type: "tool-call",
  },
  {
    output: {
      decision: {
        comments: [],
        decision: "review",
        hunks: [
          { decision: "accept", hunkId: "h1" },
          { comment: "Keep the old name", decision: "reject", hunkId: "h2" },
        ],
      },
      status: "denied",
    },
    toolCallId: "call_1",
    toolName: "edit",
    type: "tool-result",
  },
  {
    artifactId: fixtureId("artifact", 1),
    kind: "react",
    title: "Invoice table",
    type: "artifact-ref",
    versionId: fixtureId("artifactVersion", 1),
  },
  { annotationId: fixtureId("annotation", 1), type: "annotation-ref" },
  {
    data: { summary: "Prefers pnpm", versionId: fixtureId("memoryVersion", 1) },
    name: "memory-update",
    type: "data",
  },
];

export const userMessage: Message = {
  agent: null,
  authorId: userAda.id,
  conversationId: conversation.id,
  createdAt: fixtureTime(1),
  id: fixtureId("message", 1),
  model: null,
  parentId: null,
  parts: [{ text: "Can you shrink this diff?", type: "text" }],
  partsVersion: 1,
  role: "user",
  runId: fixtureId("run", 1),
  status: "complete",
  usage: null,
};

export const assistantMessage: Message = {
  agent: {
    id: fixtureId("libraryItem", 1),
    versionId: fixtureId("libraryVersion", 2),
  },
  authorId: null,
  conversationId: conversation.id,
  createdAt: fixtureTime(2),
  id: fixtureId("message", 2),
  model: "anthropic:claude-opus-5-5",
  parentId: userMessage.id,
  parts: allMessageParts,
  partsVersion: 1,
  role: "assistant",
  runId: fixtureId("run", 1),
  status: "complete",
  usage: { inputTokens: 1200, outputTokens: 340, reasoningTokens: 80 },
};

export const branchPath: BranchPath = {
  conversationId: conversation.id,
  leafId: assistantMessage.id,
  messages: [userMessage, assistantMessage],
  siblings: [
    { index: 0, messageId: userMessage.id, siblingIds: [userMessage.id] },
    {
      index: 1,
      messageId: assistantMessage.id,
      siblingIds: [fixtureId("message", 3), assistantMessage.id],
    },
  ],
};

export const runAwaitingApproval: Run = {
  assistantMessageId: fixtureId("message", 4),
  context: conversation.context,
  conversationId: conversation.id,
  createdAt: fixtureTime(3),
  createdBy: userAda.id,
  id: fixtureId("run", 2),
  lastSeq: 42,
  resolvedModel: "anthropic:claude-opus-5-5",
  state: {
    approvals: [
      {
        edits: [
          {
            hunks: [
              {
                hunkId: "h1",
                newLines: 3,
                newStart: 10,
                oldLines: 2,
                oldStart: 10,
              },
            ],
            patch: "@@ -10,2 +10,3 @@\n-a\n-b\n+a\n+b\n+c\n",
            path: "src/billing.ts",
          },
        ],
        input: { path: "src/billing.ts" },
        requestedAt: fixtureTime(3),
        toolCallId: "call_2",
        toolName: "edit",
      },
    ],
    startedAt: fixtureTime(3),
    status: "awaiting_approval",
  },
  target: { id: fixtureId("libraryItem", 1), type: "agent" },
  updatedAt: fixtureTime(3),
  usage: null,
  userMessageId: fixtureId("message", 3),
};

export const reviewerDefinition: AgentDefinition = {
  approvals: { default: "auto", tools: { edit: "ask" } },
  conversationStarters: ["Review my last commit"],
  instructions: "You are a careful reviewer.",
  kind: "agent",
  knowledgeFileIds: [fixtureId("file", 1)],
  mcpServers: [{ id: fixtureId("libraryItem", 3) }],
  model: "strong",
  parameters: { temperature: 0.2 },
  sandboxProvider: "just-bash",
  skills: [{ id: fixtureId("libraryItem", 4) }],
  tools: ["web_search", "file_search", "edit"],
};

export const agentItem: LibraryItemDetail = {
  createdAt: fixtureTime(),
  createdBy: userAda.id,
  definition: reviewerDefinition,
  description: "Reviews diffs hunk by hunk.",
  draftVersionId: fixtureId("libraryVersion", 3),
  icon: "BotIcon",
  id: fixtureId("libraryItem", 1),
  kind: "agent",
  latestVersionId: fixtureId("libraryVersion", 2),
  latestVersionNumber: 2,
  maintainers: [userAda],
  myAccess: "maintainer",
  name: "Reviewer",
  owner: { id: teamEngineering.id, type: "team" },
  publishedFrom: fixtureId("libraryItem", 9),
  updatedAt: fixtureTime(1),
  versionId: fixtureId("libraryVersion", 2),
  visibility: "published",
};

export const agentVersion: LibraryVersion = {
  createdAt: fixtureTime(),
  createdBy: userAda.id,
  definition: reviewerDefinition,
  id: fixtureId("libraryVersion", 2),
  itemId: agentItem.id,
  notes: "Stricter about naming.",
  number: 2,
  publishedAt: fixtureTime(1),
  status: "published",
};

export const grant: ResourceGrant = {
  createdAt: fixtureTime(),
  grantedBy: userAda.id,
  id: fixtureId("grant", 1),
  permission: "use",
  principal: { id: userBo.id, type: "user" },
  resourceId: agentItem.id,
  resourceType: "agent",
};

export const shareLink: ShareLink = {
  createdAt: fixtureTime(),
  createdBy: userAda.id,
  expiresAt: null,
  id: fixtureId("shareLink", 1),
  resourceId: conversation.id,
  resourceType: "conversation",
  revokedAt: null,
  token: "k2Jd8sLq0pXz4vB7nR1tYw",
  url: "https://chat.example.test/share/k2Jd8sLq0pXz4vB7nR1tYw",
};

export const file: FileRecord = {
  conversationId: null,
  createdAt: fixtureTime(),
  id: fixtureId("file", 1),
  mediaType: "application/pdf",
  name: "invoice.pdf",
  ownerId: userAda.id,
  purpose: "knowledge",
  size: 48_213,
  status: {
    chunkCount: 12,
    embeddingModel: "openai:text-embedding-3-small",
    state: "ready",
  },
};

export const sandbox: SandboxRecord = {
  conversationId: conversation.id,
  createdAt: fixtureTime(),
  id: fixtureId("sandbox", 1),
  isolation: "gvisor",
  limits: { cpu: 2, diskMb: 10_240, memoryMb: 2048, network: true },
  previews: [{ port: 5173, url: "https://s-1.sandbox.example.test" }],
  provider: "docker",
  snapshotRef: null,
  status: { state: "ready" },
  updatedAt: fixtureTime(1),
};

export const modelOptions: ModelOption[] = [
  {
    available: true,
    capabilities: ["tools"],
    contextWindow: null,
    label: "Auto",
    selector: "auto",
    target: null,
  },
  {
    available: true,
    capabilities: ["tools", "vision", "reasoning"],
    contextWindow: 200_000,
    cost: { input: 5_000_000, output: 25_000_000, tier: 4 },
    description: "Hard problems and long documents",
    displayName: "Claude Opus 5.5",
    label: "Strong",
    provider: "anthropic",
    ratings: { intelligence: 5, speed: 3 },
    selector: "strong",
    target: "anthropic:claude-opus-5-5",
  },
];

export const me: Me = {
  orgs: [org],
  persistClientCache: true,
  personalOrgId: fixtureId("org", 9),
  teams: [{ role: "admin", team: teamPlatform }],
  user: {
    email: "ada@example.test",
    id: userAda.id,
    image: null,
    isAdmin: true,
    locale: "en",
    name: "Ada",
  },
};

export const publicConfig: PublicConfig = {
  artifacts: {
    kinds: [
      "svg",
      "mermaid",
      "site",
      "document",
      "image",
      "presentation",
      "diagram",
      "spreadsheet",
    ],
    siteOrigins: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  },
  auth: { providers: [{ id: "github", name: "GitHub" }], signup: "invite" },
  brand: { faviconUrl: null, logoUrl: null, name: "Chat" },
  chatModes: false,
  features: {
    fileUploads: true,
    importers: true,
    memory: true,
    publicLinks: true,
    sandboxes: true,
    webSearch: true,
  },
  limits: { memoryMaxChars: 8000, uploadMaxMb: 25 },
  policies: { chatContexts: ["personal", "team", "org"] },
  sandbox: { default: "just-bash", providers: ["just-bash", "docker"] },
};

/**
 * A desktop agent-loop step through the model proxy: the tools are the
 * client's own, and the answer is a tool call it runs locally.
 */
export const llmProxyRequest: LlmProxyRequest = {
  context: { id: teamPlatform.id, type: "team" },
  maxOutputTokens: 4096,
  model: "strong",
  prompt: [
    {
      content: "You are a coding agent in the user's workspace.",
      role: "system",
    },
    {
      content: [{ text: "What's in package.json?", type: "text" }],
      role: "user",
    },
  ],
  stream: true,
  temperature: 0.2,
  toolChoice: { type: "auto" },
  tools: [
    {
      description: "Read a file in the workspace.",
      inputSchema: {
        properties: { path: { type: "string" } },
        required: ["path"],
        type: "object",
      },
      name: "read",
      type: "function",
    },
  ],
};

/** The same step with `stream: false`, answered as JSON. */
export const llmProxyResponse: LlmProxyResponse = {
  content: [
    {
      input: '{"path":"package.json"}',
      toolCallId: "call_1",
      toolName: "read",
      type: "tool-call",
    },
  ],
  finishReason: { raw: "tool_use", unified: "tool-calls" },
  resolvedModel: "anthropic:claude-opus-5-5",
  response: {
    id: "msg_1",
    modelId: "claude-opus-5-5",
    timestamp: fixtureTime(2),
  },
  usage: {
    inputTokens: { cacheRead: 0, noCache: 120, total: 120 },
    outputTokens: { text: 18, total: 18 },
  },
  warnings: [],
};

/** The same step streamed: each is one SSE `data:` event before `[DONE]`. */
export const llmStreamParts: LlmStreamPart[] = [
  { type: "stream-start", warnings: [] },
  {
    id: "msg_1",
    modelId: "claude-opus-5-5",
    timestamp: fixtureTime(2),
    type: "response-metadata",
  },
  { id: "call_1", toolName: "read", type: "tool-input-start" },
  { delta: '{"path":"package.json"}', id: "call_1", type: "tool-input-delta" },
  { id: "call_1", type: "tool-input-end" },
  ...llmProxyResponse.content,
  {
    finishReason: llmProxyResponse.finishReason,
    type: "finish",
    usage: llmProxyResponse.usage,
  },
];
