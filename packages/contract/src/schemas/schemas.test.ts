import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  agentItem,
  agentVersion,
  allMessageParts,
  assistantMessage,
  branchPath,
  conversation,
  file,
  fixtureId,
  fixtureTime,
  grant,
  llmProxyRequest,
  llmProxyResponse,
  llmStreamParts,
  me,
  modelOptions,
  org,
  publicConfig,
  reviewerDefinition,
  runAwaitingApproval,
  sandbox,
  shareLink,
  teamEngineering,
  teamPlatform,
  userAda,
  userMessage,
} from "../fixtures";

// Every exported schema must have round-trip cases here: valid samples parse,
// survive JSON and parse again to the same value; invalid ones are rejected.
// Enums and ids get cases derived automatically. The last test fails when a
// new schema lands without cases, so coverage can't silently drift.

interface Cases {
  readonly invalid: readonly unknown[];
  readonly valid: readonly unknown[];
}

// Loaded as whole modules so every export can be checked for cases.
const modules = {
  common: await import("./common"),
  conversations: await import("./conversations"),
  decider: await import("./decider"),
  feedback: await import("./feedback"),
  files: await import("./files"),
  grants: await import("./grants"),
  health: await import("./health"),
  keys: await import("./keys"),
  library: await import("./library"),
  linkPreview: await import("./link-preview"),
  llm: await import("./llm"),
  memory: await import("./memory"),
  messageParts: await import("./message-parts"),
  messages: await import("./messages"),
  meta: await import("./meta"),
  models: await import("./models"),
  runs: await import("./runs"),
  sandbox: await import("./sandbox"),
  search: await import("./search"),
  tenancy: await import("./tenancy"),
  usage: await import("./usage"),
};

const t = fixtureTime();
const uid = userAda.id;
const convId = conversation.id;
const msgId = userMessage.id;
const itemId = agentItem.id;
const notUuid = "not-a-uuid";
const etag = "a".repeat(64);

const cases: Record<string, Cases> = {
  // common
  "common.descriptionSchema": {
    invalid: ["x".repeat(2001), 1],
    valid: ["", "A reviewer."],
  },
  "common.jsonValueSchema": {
    invalid: [undefined, () => 1, Number.NaN],
    valid: [null, 1, "s", [1, { a: [true, null] }], { nested: { deep: [1] } }],
  },
  "common.microUsdSchema": { invalid: [-1, 1.5, "1"], valid: [0, 1_000_000] },
  "common.nameSchema": {
    invalid: ["", "   ", "x".repeat(201)],
    valid: ["Reviewer"],
  },
  "common.okSchema": { invalid: [{ ok: false }, {}], valid: [{ ok: true }] },
  "common.pageInputSchema": {
    invalid: [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }],
    valid: [{}, { cursor: "abc", limit: 10 }],
  },
  "common.providerMetadataSchema": {
    invalid: [{ anthropic: "flat" }, []],
    valid: [{}, { anthropic: { signature: "sig" } }],
  },
  "common.timestampSchema": {
    invalid: ["2026-09-26", "yesterday", 0],
    valid: [t, "2026-09-26T09:00:00+10:00"],
  },

  // conversations
  "conversations.conversationSchema": {
    invalid: [
      { ...conversation, context: { type: "team" } },
      { ...conversation, title: "x".repeat(201) },
    ],
    valid: [
      conversation,
      { ...conversation, context: { type: "personal" }, title: null },
    ],
  },
  "conversations.createConversationInputSchema": {
    invalid: [{ context: { type: "space" } }, { title: "" }],
    valid: [{}, { context: { id: org.id, type: "org" }, title: "Plans" }],
  },
  "conversations.forkConversationInputSchema": {
    invalid: [{ id: convId }],
    valid: [{ id: convId, leafId: msgId }],
  },
  "conversations.listConversationsInputSchema": {
    invalid: [{ ownership: "theirs" }, { limit: 1000 }],
    valid: [{}, { archived: true, contextType: "team", ownership: "shared" }],
  },
  "conversations.participantSchema": {
    invalid: [{ permission: "owner", state: {}, user: userAda }],
    valid: [
      { permission: "viewer", state: conversation.myState, user: userAda },
    ],
  },
  "conversations.participantStateSchema": {
    invalid: [{ userId: uid }],
    valid: [conversation.myState],
  },
  "conversations.setConversationContextInputSchema": {
    invalid: [{ id: convId }],
    valid: [{ context: { type: "personal" }, id: convId }],
  },
  "conversations.updateConversationInputSchema": {
    invalid: [{ id: convId, title: "  " }],
    valid: [
      { id: convId },
      { archived: true, defaultTarget: null, id: convId, pinned: true },
    ],
  },
  "conversations.updateParticipantStateInputSchema": {
    invalid: [{ activeLeafId: notUuid, conversationId: convId }],
    valid: [
      { activeLeafId: msgId, conversationId: convId, followingUserId: null },
    ],
  },

  // decider
  "decider.deciderAnswerSchema": {
    invalid: [
      { id: "q", probability: 1.2, type: "boolean", value: true },
      { id: "q", probability: 1, type: "score", value: 2 },
    ],
    valid: [
      { id: "needsRetrieval", probability: 0.9, type: "boolean", value: true },
      {
        distribution: { cheap: 0.3, strong: 0.7 },
        id: "route",
        probability: 0.7,
        type: "choice",
        value: "strong",
      },
      { id: "risk", probability: 0.8, type: "score", value: 0.1 },
    ],
  },
  "decider.deciderQuestionSchema": {
    invalid: [
      { id: "q", options: [{ id: "only" }], prompt: "?", type: "choice" },
      { id: "Bad Id", prompt: "?", type: "boolean" },
    ],
    valid: [
      {
        id: "needsRetrieval",
        prompt: "Does this need the user's files?",
        type: "boolean",
      },
      {
        id: "route",
        options: [{ id: "cheap" }, { id: "strong" }],
        prompt: "Which model?",
        type: "choice",
      },
      {
        id: "risk",
        prompt: "How risky is this command?",
        rubric: "0 safe, 1 destructive",
        type: "score",
      },
    ],
  },
  "decider.deciderStateSchema": {
    invalid: [{ history: [{ role: "system", text: "x" }], input: "x" }],
    valid: [
      { input: "rm -rf node_modules" },
      {
        facts: { cwd: "/work" },
        history: [{ role: "user", text: "hi" }],
        input: "x",
      },
    ],
  },
  "decider.decisionLogEntrySchema": {
    invalid: [{ adapter: "gpt" }],
    valid: [
      {
        adapter: "llm-fallback",
        answer: {
          id: "needsRetrieval",
          probability: 0.9,
          type: "boolean",
          value: false,
        },
        conversationId: convId,
        createdAt: t,
        error: null,
        id: fixtureId("decision", 1),
        latencyMs: 120,
        model: "ollama:llama3.2",
        purpose: "retrieval-gate",
        question: { id: "needsRetrieval", prompt: "?", type: "boolean" },
        runId: null,
        userId: uid,
      },
    ],
  },
  "decider.listDecisionsInputSchema": {
    invalid: [{ purpose: "fun" }],
    valid: [{}, { purpose: "auto-route" }],
  },

  // feedback
  "feedback.feedbackSchema": {
    invalid: [{ rating: "meh" }],
    valid: [
      {
        comment: null,
        createdAt: t,
        id: fixtureId("feedback", 1),
        messageId: msgId,
        rating: "up",
        shareWithMaintainers: false,
        updatedAt: t,
        userId: uid,
      },
    ],
  },
  "feedback.setFeedbackInputSchema": {
    invalid: [{ messageId: msgId, rating: 1 }],
    valid: [
      { messageId: msgId, rating: "down" },
      {
        comment: "Wrong file",
        messageId: msgId,
        rating: "down",
        shareWithMaintainers: true,
      },
    ],
  },

  // files
  "files.artifactSchema": {
    invalid: [{ conversationId: convId }],
    valid: [
      {
        conversationId: convId,
        createdAt: t,
        id: fixtureId("artifact", 1),
        kind: "html",
        latestVersionId: fixtureId("artifactVersion", 1),
        messageId: msgId,
        title: "Page",
        updatedAt: t,
      },
      {
        conversationId: convId,
        createdAt: t,
        id: fixtureId("artifact", 2),
        kind: "code",
        latestVersionId: null,
        messageId: msgId,
        title: "Script",
        updatedAt: t,
      },
    ],
  },
  "files.artifactVersionSchema": {
    invalid: [{ artifactId: fixtureId("artifact", 1), number: 0 }],
    valid: [
      {
        artifactId: fixtureId("artifact", 1),
        content: "<p>hi</p>",
        createdAt: t,
        id: fixtureId("artifactVersion", 1),
        language: null,
        messageId: msgId,
        number: 1,
      },
    ],
  },
  "files.fileSchema": { invalid: [{ ...file, size: -1 }], valid: [file] },
  "files.fileSearchHitSchema": {
    invalid: [
      {
        chunkId: fixtureId("fileChunk", 1),
        fileId: file.id,
        filename: "a",
        page: null,
        score: 2,
        text: "",
      },
    ],
    valid: [
      {
        chunkId: fixtureId("fileChunk", 1),
        fileId: file.id,
        filename: "a.pdf",
        page: 2,
        score: 0.8,
        text: "Total",
      },
    ],
  },
  "files.fileSearchInputSchema": {
    invalid: [{ query: "" }, { limit: 51, query: "x" }],
    valid: [{ query: "invoice total" }],
  },
  "files.fileStatusSchema": {
    invalid: [{ state: "ready" }, { state: "queued" }],
    valid: [
      { state: "uploaded" },
      { state: "processing" },
      file.status,
      { message: "Unreadable PDF", state: "failed" },
    ],
  },
  "files.fileUrlSchema": {
    invalid: [{ expiresAt: t, url: "nope" }],
    valid: [{ expiresAt: t, url: "https://files.example.test/a?sig=1" }],
  },
  "files.listFilesInputSchema": {
    invalid: [{ purpose: "avatar" }],
    valid: [{}, { conversationId: convId, purpose: "knowledge" }],
  },

  // grants
  "grants.createGrantInputSchema": {
    invalid: [
      {
        permission: "use",
        principal: { id: uid, type: "user" },
        resourceId: convId,
        resourceType: "conversation",
      },
      {
        permission: "editor",
        principal: { id: uid, type: "user" },
        resourceId: itemId,
        resourceType: "agent",
      },
    ],
    valid: [
      {
        permission: "editor",
        principal: { id: uid, type: "user" },
        resourceId: convId,
        resourceType: "conversation",
      },
      {
        permission: "view",
        principal: { id: teamPlatform.id, type: "team" },
        resourceId: itemId,
        resourceType: "skill",
      },
    ],
  },
  "grants.createShareLinkInputSchema": {
    invalid: [{ resourceId: convId, resourceType: "file" }],
    valid: [{ expiresAt: t, resourceId: convId, resourceType: "conversation" }],
  },
  "grants.grantScopeSchema": {
    invalid: [
      { permission: "viewer", resourceId: itemId, resourceType: "prompt" },
    ],
    valid: [{ permission: "edit", resourceId: itemId, resourceType: "prompt" }],
  },
  "grants.resourceGrantSchema": {
    invalid: [
      { ...grant, permission: "viewer" },
      { ...grant, principal: { id: uid, type: "role" } },
    ],
    valid: [grant],
  },
  "grants.resourceRefSchema": {
    invalid: [{ resourceId: notUuid, resourceType: "agent" }],
    valid: [{ resourceId: itemId, resourceType: "agent" }],
  },
  "grants.sharedResourceSchema": {
    invalid: [{ resourceType: "conversation", title: null }],
    valid: [
      { branch: branchPath, resourceType: "conversation", title: "Plans" },
      {
        item: {
          definition: reviewerDefinition,
          description: "",
          exportedAt: t,
          format: "native",
          formatVersion: 1,
          icon: null,
          name: "R",
        },
        resourceType: "agent",
      },
    ],
  },
  "grants.shareLinkSchema": {
    invalid: [{ ...shareLink, token: "short" }],
    valid: [shareLink],
  },
  "grants.updateGrantInputSchema": {
    invalid: [{ id: grant.id, permission: "owner" }],
    valid: [
      { id: grant.id, permission: "view" },
      { id: grant.id, permission: "viewer" },
    ],
  },

  // keys
  // health
  "health.healthCheckSchema": {
    invalid: [{ message: null, status: "sideways" }, { status: "up" }],
    valid: [
      { message: null, status: "up" },
      { message: "the job queue didn't start", status: "down" },
    ],
  },
  "health.healthInputSchema": {
    invalid: [{ ready: "yes" }],
    valid: [{}, { ready: true }],
  },
  "health.healthSchema": {
    invalid: [
      { checks: { database: { message: null, status: "up" } }, status: "ok" },
      {
        checks: {
          database: { message: null, status: "up" },
          jobs: { message: null, status: "up" },
        },
        status: "fine",
      },
    ],
    valid: [
      {
        checks: {
          database: { message: null, status: "up" },
          jobs: { message: null, status: "up" },
        },
        status: "ok",
      },
      {
        checks: {
          database: { message: "no database", status: "down" },
          jobs: { message: "no database", status: "down" },
        },
        status: "degraded",
      },
    ],
  },

  "keys.createProviderKeyInputSchema": {
    invalid: [
      {
        apiKey: "test-key-value",
        provider: "openai",
        scope: { type: "instance" },
      },
      { apiKey: "short", provider: "openai", scope: { id: uid, type: "user" } },
    ],
    valid: [
      {
        apiKey: "test-key-value",
        provider: "openai",
        scope: { id: uid, type: "user" },
      },
    ],
  },
  "keys.keyScopeSchema": {
    invalid: [{ type: "org" }],
    valid: [{ type: "instance" }, { id: org.id, type: "org" }],
  },
  "keys.listProviderKeysInputSchema": {
    invalid: [{ scopeType: "global" }],
    valid: [{}, { scopeId: org.id, scopeType: "org" }],
  },
  "keys.providerKeySchema": {
    invalid: [{ hint: "abcd" }],
    valid: [
      {
        baseURL: null,
        createdAt: t,
        createdBy: uid,
        hint: "wxyz",
        id: fixtureId("providerKey", 1),
        label: "Team key",
        lastUsedAt: null,
        provider: "anthropic",
        scope: { id: teamPlatform.id, type: "team" },
        source: "database",
      },
    ],
  },
  "keys.verifyProviderKeyOutputSchema": {
    invalid: [{ ok: "yes" }],
    valid: [{ message: null, ok: true }],
  },
  "keys.writableKeyScopeSchema": {
    invalid: [{ type: "instance" }],
    valid: [{ id: teamPlatform.id, type: "team" }],
  },

  // library
  "library.agentDefinitionSchema": {
    invalid: [
      { instructions: "x", kind: "agent" },
      {
        ...reviewerDefinition,
        conversationStarters: Array.from({ length: 9 }, () => "hi"),
      },
    ],
    valid: [
      reviewerDefinition,
      { instructions: "", kind: "agent", model: "fast" },
    ],
  },
  "library.createLibraryItemInputSchema": {
    invalid: [
      { definition: { kind: "agent" }, name: "A" },
      { definition: reviewerDefinition, name: "" },
    ],
    valid: [{ definition: reviewerDefinition, name: "Reviewer" }],
  },
  "library.duplicateLibraryItemInputSchema": {
    invalid: [{}],
    valid: [{ id: itemId }, { id: itemId, name: "Copy" }],
  },
  "library.getLibraryItemInputSchema": {
    invalid: [{ id: itemId, revision: "newest" }],
    valid: [
      { id: itemId },
      { id: itemId, revision: "draft" },
      { id: itemId, revision: agentVersion.id },
    ],
  },
  "library.libraryDefinitionInputSchema": {
    invalid: [
      { kind: "workflow" },
      {
        auth: { type: "header" },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test",
      },
    ],
    valid: [
      reviewerDefinition,
      {
        auth: {
          headerName: "Authorization",
          type: "header",
          value: "Bearer test-token",
        },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test",
      },
    ],
  },
  "library.libraryDefinitionSchema": {
    invalid: [
      {
        auth: { headerName: "X", type: "header", value: "secret" },
        kind: "mcp_server",
        transport: "http",
        url: "https://m.test",
      },
    ],
    valid: [
      reviewerDefinition,
      {
        kind: "prompt",
        template: "Summarise {{text}}",
        variables: [{ name: "text" }],
      },
      {
        files: [{ fileId: file.id, path: "scripts/run.sh" }],
        kind: "skill",
        skillMd: "---\nname: x\n---\n",
      },
      {
        auth: { configured: true, headerName: "X-Key", type: "header" },
        kind: "mcp_server",
        transport: "sse",
        url: "https://m.test/sse",
      },
      { kind: "preset", model: "fast", parameters: {} },
    ],
  },
  "library.libraryExportSchema": {
    invalid: [{ format: "native", formatVersion: 2 }],
    valid: [
      {
        definition: reviewerDefinition,
        description: "",
        exportedAt: t,
        format: "native",
        formatVersion: 1,
        icon: null,
        name: "Reviewer",
      },
    ],
  },
  "library.libraryImportInputSchema": {
    invalid: [{ document: { format: "gpts" } }],
    valid: [
      { document: { data: { name: "Agent" }, format: "librechat-agent" } },
    ],
  },
  "library.libraryItemDetailSchema": {
    invalid: [{ ...agentItem, owner: { type: "user" } }],
    valid: [agentItem, { ...agentItem, definition: null, myAccess: "use" }],
  },
  "library.libraryItemSchema": {
    invalid: [{ ...agentItem, kind: "workflow" }],
    valid: [(({ definition: _d, versionId: _v, ...item }) => item)(agentItem)],
  },
  "library.libraryRevisionSchema": {
    invalid: ["newest", notUuid],
    valid: ["draft", "latest", agentVersion.id],
  },
  "library.libraryTargetSchema": {
    invalid: [{ id: uid, type: "user" }],
    valid: [
      { id: teamPlatform.id, type: "team" },
      { id: org.id, type: "org" },
    ],
  },
  "library.libraryVersionSchema": {
    invalid: [{ ...agentVersion, number: 0 }],
    valid: [agentVersion],
  },
  "library.listLibraryInputSchema": {
    invalid: [{}, { tab: "everything" }],
    valid: [
      { tab: "mine" },
      {
        kind: "prompt",
        ownerId: teamPlatform.id,
        ownerType: "team",
        query: "sum",
        tab: "libraries",
      },
    ],
  },
  "library.mcpAuthInputSchema": {
    invalid: [{ type: "basic" }],
    valid: [
      { type: "none" },
      { scopes: ["repo"], type: "oauth" },
      { headerName: "X", type: "header" },
    ],
  },
  "library.mcpAuthSchema": {
    invalid: [{ headerName: "X", type: "header" }],
    valid: [
      { type: "none" },
      { configured: false, headerName: "X", type: "header" },
    ],
  },
  "library.mcpConnectionStatusSchema": {
    invalid: [{ state: "connected" }],
    valid: [
      { state: "connected", toolCount: 3 },
      { state: "needs_auth" },
      { message: "down", state: "error" },
    ],
  },
  "library.mcpServerDefinitionInputSchema": {
    invalid: [
      { kind: "mcp_server", transport: "stdio", url: "https://m.test" },
    ],
    valid: [{ kind: "mcp_server", transport: "http", url: "https://m.test" }],
  },
  "library.mcpServerDefinitionSchema": {
    invalid: [{ kind: "mcp_server", transport: "http", url: "https://m.test" }],
    valid: [
      {
        auth: { type: "none" },
        kind: "mcp_server",
        transport: "http",
        url: "https://m.test",
      },
    ],
  },
  "library.mcpToolSchema": {
    invalid: [{ description: null, inputSchema: {}, name: "has space" }],
    valid: [
      {
        description: "List issues",
        inputSchema: { type: "object" },
        name: "list_issues",
      },
    ],
  },
  "library.presetDefinitionSchema": {
    invalid: [{ kind: "preset" }],
    valid: [{ instructions: "Be brief.", kind: "preset", model: "fast" }],
  },
  "library.promptDefinitionSchema": {
    invalid: [
      { kind: "prompt", template: "" },
      { command: "/Sum", kind: "prompt", template: "x" },
    ],
    valid: [
      { command: "summarise", kind: "prompt", template: "Summarise {{text}}" },
    ],
  },
  "library.promptVariableSchema": {
    invalid: [{ name: "has space" }, { name: "1st" }],
    valid: [{ default: "", name: "text" }],
  },
  "library.publishToLibraryInputSchema": {
    invalid: [{ id: itemId, target: { id: uid, type: "user" } }],
    valid: [{ id: itemId, target: { id: teamPlatform.id, type: "team" } }],
  },
  "library.publishVersionInputSchema": {
    invalid: [{ notes: "x" }],
    valid: [{ id: itemId, notes: "Tighter rules." }],
  },
  "library.restoreVersionInputSchema": {
    invalid: [{ id: itemId }],
    valid: [{ id: itemId, versionId: agentVersion.id }],
  },
  "library.setMaintainersInputSchema": {
    invalid: [{ id: itemId, userIds: [] }],
    valid: [{ id: itemId, userIds: [uid] }],
  },
  "library.skillDefinitionSchema": {
    invalid: [
      {
        files: [{ fileId: file.id, path: "/etc/passwd" }],
        kind: "skill",
        skillMd: "x",
      },
      {
        files: [{ fileId: file.id, path: "a/../../b" }],
        kind: "skill",
        skillMd: "x",
      },
    ],
    valid: [{ kind: "skill", skillMd: "# Skill" }],
  },
  "library.skillFileSchema": {
    invalid: [
      { fileId: file.id, path: "../x" },
      { fileId: file.id, path: "/abs" },
    ],
    valid: [{ fileId: file.id, path: "scripts/a..b.sh" }],
  },
  "library.updateLibraryItemInputSchema": {
    invalid: [{ id: itemId, name: "" }],
    valid: [
      { id: itemId },
      { definition: reviewerDefinition, icon: null, id: itemId },
    ],
  },
  // link previews (101)
  "linkPreview.linkPreviewImageInputSchema": {
    invalid: [{}, { src: "" }, { src: "x".repeat(8193) }],
    valid: [{ src: "eyJ1IjoiaHR0cHM6Ly9hLnRlc3QvYS5wbmcifQ.c2ln" }],
  },
  "linkPreview.linkPreviewImagePathSchema": {
    invalid: [
      "https://evil.test/a.png",
      "//evil.test/a.png",
      "/\\evil.test/a.png",
      "javascript:alert(1)",
      "",
    ],
    valid: ["/api/link-preview/image?src=abc.def"],
  },
  "linkPreview.linkPreviewInputSchema": {
    invalid: [
      { url: "ftp://example.test/" },
      { url: "javascript:alert(1)" },
      { url: "file:///etc/passwd" },
      { url: `https://example.test/${"a".repeat(2048)}` },
      {},
    ],
    valid: [{ url: "https://example.test/post?id=1" }],
  },
  "linkPreview.linkPreviewSchema": {
    invalid: [
      { fetchedAt: t, finalUrl: "https://a.test/", url: "nope" },
      {
        fetchedAt: t,
        finalUrl: "https://a.test/",
        image: { url: "https://cdn.test/og.png" },
        url: "https://a.test/",
      },
      {
        fetchedAt: t,
        finalUrl: "https://a.test/",
        title: "x".repeat(301),
        url: "https://a.test/",
      },
    ],
    valid: [
      { fetchedAt: t, finalUrl: "https://a.test/", url: "http://a.test/" },
      {
        description: "A page about things.",
        fetchedAt: t,
        finalUrl: "https://a.test/post",
        icon: "/api/link-preview/image?src=icon.sig",
        image: {
          alt: "A picture",
          height: 630,
          url: "/api/link-preview/image?src=image.sig",
          width: 1200,
        },
        siteName: "A Site",
        title: "A post",
        url: "https://a.test/p",
      },
    ],
  },
  "linkPreview.linkPreviewUrlSchema": {
    invalid: ["data:text/html,hi", "mailto:a@b.test", "/relative"],
    valid: ["https://example.test/", "http://example.test:8080/a?b#c"],
  },

  // llm
  "llm.llmContentPartSchema": {
    invalid: [{}, { type: "" }, "text"],
    valid: llmProxyResponse.content,
  },
  "llm.llmFinishReasonSchema": {
    invalid: [{ unified: "done" }, { raw: "stop" }],
    valid: [{ unified: "stop" }, llmProxyResponse.finishReason],
  },
  "llm.llmFunctionToolSchema": {
    invalid: [
      { ...llmProxyRequest.tools?.[0], type: "provider" },
      { ...llmProxyRequest.tools?.[0], name: "has space" },
      { ...llmProxyRequest.tools?.[0], inputSchema: "object" },
    ],
    valid: [
      ...(llmProxyRequest.tools ?? []),
      {
        inputExamples: [{ input: { path: "a.ts" } }],
        inputSchema: { type: "object" },
        name: "mcp.github:search",
        strict: true,
        type: "function",
      },
    ],
  },
  "llm.llmPromptMessageSchema": {
    invalid: [{ content: "hi", role: "developer" }, { role: "user" }],
    valid: [
      ...llmProxyRequest.prompt,
      {
        content: [{ text: "cached", type: "text" }],
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        role: "user",
      },
    ],
  },
  "llm.llmProxyRequestSchema": {
    invalid: [
      { ...llmProxyRequest, context: undefined },
      { ...llmProxyRequest, stream: undefined },
      { ...llmProxyRequest, prompt: [] },
      { ...llmProxyRequest, model: "Not A Model" },
      { ...llmProxyRequest, temperature: 3 },
      { ...llmProxyRequest, reasoning: "max" },
    ],
    valid: [
      llmProxyRequest,
      {
        context: { type: "personal" },
        model: "ollama:llama3.2:3b",
        prompt: [{ content: "hi", role: "user" }],
        reasoning: "low",
        responseFormat: { schema: { type: "object" }, type: "json" },
        stream: false,
        toolChoice: { toolName: "read", type: "tool" },
      },
    ],
  },
  "llm.llmProxyResponseSchema": {
    invalid: [
      { ...llmProxyResponse, resolvedModel: "strong" },
      { ...llmProxyResponse, warnings: undefined },
    ],
    valid: [
      llmProxyResponse,
      {
        content: [{ text: "Hello", type: "text" }],
        finishReason: { unified: "stop" },
        resolvedModel: "openai:gpt-5",
        usage: { inputTokens: {}, outputTokens: {} },
        warnings: [{ feature: "topK", type: "unsupported" }],
      },
    ],
  },
  "llm.llmResponseFormatSchema": {
    invalid: [{ type: "xml" }, { schema: "object", type: "json" }],
    valid: [{ type: "text" }, { name: "answer", type: "json" }],
  },
  "llm.llmStreamErrorPartSchema": {
    invalid: [{ error: "boom", type: "error" }],
    valid: [
      {
        error: {
          code: "provider_error",
          message: "The provider failed.",
          retryable: true,
        },
        type: "error",
      },
    ],
  },
  "llm.llmStreamPartSchema": {
    invalid: [{ delta: "x" }, null],
    valid: llmStreamParts,
  },
  "llm.llmToolChoiceSchema": {
    invalid: [{ type: "tool" }, { type: "any" }],
    valid: [{ type: "none" }, { toolName: "read", type: "tool" }],
  },
  "llm.llmUsageSchema": {
    invalid: [{ inputTokens: { total: -1 }, outputTokens: {} }, {}],
    valid: [llmProxyResponse.usage, { inputTokens: {}, outputTokens: {} }],
  },

  // memory
  "memory.memoryDocumentSchema": {
    invalid: [
      {
        content: "",
        maxChars: 0,
        mode: "auto",
        updatedAt: null,
        versionId: null,
      },
    ],
    valid: [
      {
        content: "- Prefers pnpm",
        maxChars: 8000,
        mode: "auto",
        updatedAt: t,
        versionId: fixtureId("memoryVersion", 1),
      },
    ],
  },
  "memory.memoryPatchSchema": {
    invalid: [
      { op: "append", text: "" },
      { op: "rewrite", text: "x" },
    ],
    valid: [
      { op: "append", text: "- Uses Vim" },
      { find: "pnpm", op: "replace", replace: "bun" },
      { find: "Vim", op: "delete" },
    ],
  },
  "memory.memoryVersionSchema": {
    invalid: [
      {
        content: "",
        createdAt: t,
        id: fixtureId("memoryVersion", 1),
        number: 1,
        source: { type: "agent" },
      },
    ],
    valid: [
      {
        content: "- Prefers pnpm",
        createdAt: t,
        id: fixtureId("memoryVersion", 2),
        number: 2,
        source: {
          conversationId: convId,
          messageId: msgId,
          runId: runAwaitingApproval.id,
          type: "agent",
        },
      },
    ],
  },
  "memory.memoryVersionSourceSchema": {
    invalid: [{ type: "revert" }],
    valid: [
      { type: "user" },
      { fromVersionId: fixtureId("memoryVersion", 1), type: "revert" },
    ],
  },
  "memory.revertMemoryInputSchema": {
    invalid: [{}],
    valid: [{ versionId: fixtureId("memoryVersion", 1) }],
  },
  "memory.updateMemoryInputSchema": {
    invalid: [{ content: "x" }],
    valid: [
      { baseVersionId: null, content: "" },
      { baseVersionId: fixtureId("memoryVersion", 1), content: "- a" },
    ],
  },
  "memory.updateMemoryToolInputSchema": {
    invalid: [
      { patches: [], summary: "x" },
      { patches: [{ op: "append", text: "a" }], summary: "" },
    ],
    valid: [
      {
        patches: [{ op: "append", text: "- Prefers pnpm" }],
        summary: "Prefers pnpm",
      },
    ],
  },

  // message parts
  "messageParts.annotationRefPartSchema": {
    invalid: [{ annotationId: notUuid, type: "annotation-ref" }],
    valid: [allMessageParts[8]],
  },
  "messageParts.approvalDecisionSchema": {
    invalid: [{ decision: "review", hunks: [] }, { decision: "maybe" }],
    valid: [
      { decision: "approve" },
      { decision: "reject", reason: "Too risky" },
      { decision: "review", hunks: [{ decision: "accept", hunkId: "h1" }] },
    ],
  },
  "messageParts.approvalStateSchema": {
    invalid: [{ state: "pending" }, { decidedBy: uid, state: "decided" }],
    valid: [
      { state: "not-required" },
      { requestedAt: t, state: "pending" },
      {
        decidedAt: t,
        decidedBy: uid,
        decision: { decision: "approve" },
        state: "decided",
      },
    ],
  },
  "messageParts.artifactRefPartSchema": {
    invalid: [{ type: "artifact-ref" }],
    valid: [allMessageParts[7]],
  },
  "messageParts.citationSchema": {
    invalid: [{ kind: "url", url: "not a url" }, { kind: "file" }],
    valid: [
      { kind: "url", url: "https://example.test" },
      { fileId: file.id, kind: "file", page: 3 },
    ],
  },
  "messageParts.dataPartSchema": {
    invalid: [
      { data: 1, name: "Memory_Update", type: "data" },
      { name: "x", type: "data" },
    ],
    valid: [allMessageParts[9], { data: null, name: "progress", type: "data" }],
  },
  "messageParts.filePartSchema": {
    invalid: [
      { mediaType: "image/png", source: { kind: "url" }, type: "file" },
    ],
    valid: [
      allMessageParts[3],
      {
        mediaType: "image/png",
        source: { kind: "url", url: "https://example.test/a.png" },
        type: "file",
      },
    ],
  },
  "messageParts.fileSourceSchema": {
    invalid: [{ fileId: notUuid, kind: "file" }, { kind: "s3" }],
    valid: [{ fileId: file.id, kind: "file" }],
  },
  "messageParts.hunkDecisionSchema": {
    invalid: [
      { decision: "accept", hunkId: "" },
      { decision: "skip", hunkId: "h1" },
    ],
    valid: [{ comment: "why", decision: "reject", hunkId: "h1" }],
  },
  "messageParts.lineCommentSchema": {
    invalid: [
      { line: 0, path: "a.ts", text: "x" },
      { line: 1, path: "", text: "x" },
    ],
    valid: [{ line: 12, path: "src/a.ts", text: "Rename this" }],
  },
  "messageParts.messagePartSchema": {
    invalid: [{ type: "image" }, { text: 1, type: "text" }, {}],
    valid: allMessageParts,
  },
  "messageParts.partsVersionSchema": { invalid: [0, 2, "1"], valid: [1] },
  "messageParts.reasoningPartSchema": {
    invalid: [{ type: "reasoning" }],
    valid: [allMessageParts[1]],
  },
  "messageParts.sourcePartSchema": {
    invalid: [{ id: "", source: {}, type: "source" }],
    valid: [allMessageParts[4]],
  },
  "messageParts.stepStartPartSchema": {
    invalid: [{ type: "step" }],
    valid: [{ type: "step-start" }],
  },
  "messageParts.textPartSchema": {
    invalid: [{ type: "text" }],
    valid: [{ text: "", type: "text" }],
  },
  "messageParts.toolCallPartSchema": {
    invalid: [
      { ...(allMessageParts[5] as object), toolName: "has space" },
      { type: "tool-call" },
    ],
    valid: [allMessageParts[5]],
  },
  "messageParts.toolNameSchema": {
    invalid: ["", "has space", "x".repeat(129)],
    valid: ["web_search", "mcp.github:list-issues"],
  },
  "messageParts.toolOutputSchema": {
    invalid: [{ status: "success" }, { status: "ok", value: 1 }],
    valid: [
      { status: "success", value: { rows: 3 } },
      { message: "boom", status: "error" },
    ],
  },
  "messageParts.toolResultPartSchema": {
    invalid: [{ toolCallId: "c", type: "tool-result" }],
    valid: [allMessageParts[6]],
  },
  "messageParts.userMessagePartSchema": {
    invalid: [allMessageParts[1], allMessageParts[5]],
    valid: [{ text: "hi", type: "text" }, allMessageParts[3]],
  },

  // messages
  "messages.agentVersionRefSchema": {
    invalid: [{ id: itemId }],
    valid: [assistantMessage.agent],
  },
  "messages.branchPathSchema": {
    invalid: [{ ...branchPath, leafId: notUuid }],
    valid: [branchPath],
  },
  "messages.messageNodeSchema": {
    invalid: [{ createdAt: t, id: msgId, role: "user" }],
    valid: [{ createdAt: t, id: msgId, parentId: null, role: "user" }],
  },
  "messages.messageSchema": {
    invalid: [
      { ...userMessage, partsVersion: 2 },
      { ...userMessage, role: "tool" },
    ],
    valid: [userMessage, assistantMessage],
  },
  "messages.messageTreeSchema": {
    invalid: [{ conversationId: convId }],
    valid: [
      {
        conversationId: convId,
        nodes: [{ createdAt: t, id: msgId, parentId: null, role: "user" }],
      },
    ],
  },
  "messages.siblingInfoSchema": {
    invalid: [
      { index: 0, messageId: msgId, siblingIds: [] },
      { index: -1, messageId: msgId, siblingIds: [msgId] },
    ],
    valid: branchPath.siblings,
  },

  // meta
  "meta.listModelsInputSchema": {
    invalid: [{ contextType: "space" }],
    valid: [{}, { contextId: teamPlatform.id, contextType: "team" }],
  },
  "meta.meSchema": {
    invalid: [
      { ...me, personalOrgId: notUuid },
      { ...me, persistClientCache: undefined },
    ],
    valid: [me, { ...me, persistClientCache: false }],
  },
  "meta.publicConfigSchema": {
    invalid: [
      { ...publicConfig, features: { importers: true } },
      { ...publicConfig, brand: { name: "" } },
    ],
    valid: [publicConfig],
  },
  "meta.shortcutOverridesSchema": {
    invalid: [
      { "chat.new": ["Mod+K", "Mod+J", "Mod+L", "Mod+P"] },
      { "chat.new": "Mod+K" },
      { "": ["Mod+K"] },
      Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`s.${i}`, []])),
    ],
    valid: [{}, { "chat.new": ["Mod+Shift+O"], "settings.open": [] }],
  },
  "meta.updateUserSettingsInputSchema": {
    invalid: [{ locale: 1 }, { shortcuts: { "chat.new": "Mod+K" } }],
    valid: [
      {},
      { defaultTarget: null, locale: "en" },
      { shortcuts: { "chat.new": ["Mod+Shift+O"] } },
    ],
  },
  "meta.userSettingsSchema": {
    invalid: [
      { defaultContext: { type: "personal" } },
      {
        defaultContext: { type: "personal" },
        defaultTarget: null,
        locale: null,
      },
    ],
    valid: [
      {
        defaultContext: { type: "personal" },
        defaultTarget: null,
        locale: null,
        shortcuts: {},
      },
      {
        defaultContext: { type: "personal" },
        defaultTarget: null,
        locale: "en",
        shortcuts: { "palette.open": ["Mod+P"] },
      },
    ],
  },

  // models
  "models.modelAliasSchema": {
    invalid: ["Fast", "a b", "anthropic:x"],
    valid: ["fast", "auto"],
  },
  "models.modelCostSchema": {
    invalid: [{ tier: 0 }, { tier: 6 }, { input: -1, tier: 1 }, { tier: 2.5 }],
    valid: [{ tier: 1 }, { input: 3_000_000, output: 15_000_000, tier: 3 }],
  },
  "models.modelOptionSchema": {
    invalid: [
      { ...modelOptions[1], selector: "A B" },
      { ...modelOptions[1], displayName: "" },
      { ...modelOptions[1], ratings: { speed: 9 } },
      { ...modelOptions[1], cost: { input: 1 } },
    ],
    valid: modelOptions,
  },
  "models.modelParametersSchema": {
    invalid: [
      { temperature: 3 },
      { maxOutputTokens: 0 },
      { reasoningEffort: "max" },
    ],
    valid: [{}, { maxOutputTokens: 1024, temperature: 0.2, topP: 1 }],
  },
  "models.modelRatingsSchema": {
    invalid: [{ speed: 0 }, { intelligence: 6 }, { speed: 1.5 }],
    valid: [{}, { speed: 5 }, { intelligence: 1, speed: 3 }],
  },
  "models.modelRefSchema": {
    invalid: ["fast", "anthropic:", ":model", "anthropic: x"],
    valid: [
      "anthropic:claude-opus-5-5",
      "ollama:llama3.2:3b",
      "openrouter:meta/llama-4",
    ],
  },
  "models.modelSelectorSchema": {
    invalid: ["", "Has Space"],
    valid: ["auto", "openai:gpt-5"],
  },
  "models.modelTierSchema": {
    invalid: [0, 6, 2.5, "3"],
    valid: [1, 3, 5],
  },
  "models.providerIdSchema": {
    invalid: ["OpenAI", "1x", ""],
    valid: ["openai", "my-gateway"],
  },
  "models.tokenUsageSchema": {
    invalid: [{ inputTokens: -1, outputTokens: 0 }, { inputTokens: 1 }],
    valid: [
      { inputTokens: 1, outputTokens: 2 },
      { cachedInputTokens: 5, inputTokens: 10, outputTokens: 2 },
    ],
  },

  // runs
  "runs.createRunInputSchema": {
    invalid: [
      {
        conversationId: convId,
        input: { parentId: null, parts: [], type: "message" },
      },
      { conversationId: convId, input: { type: "regenerate" } },
      {
        conversationId: convId,
        idempotencyKey: "short",
        input: { type: "regenerate", userMessageId: msgId },
      },
    ],
    valid: [
      {
        context: { type: "personal" },
        conversationId: convId,
        idempotencyKey: "retry-key-123",
        input: {
          parentId: null,
          parts: [{ text: "hi", type: "text" }],
          type: "message",
        },
        options: { webSearch: "on" },
        target: { model: "auto", type: "model" },
      },
      {
        conversationId: convId,
        input: { type: "regenerate", userMessageId: msgId },
      },
      // A thinking level and fast mode for this turn (105).
      {
        conversationId: convId,
        input: { type: "regenerate", userMessageId: msgId },
        options: { fast: true, reasoning: "low" },
        target: { model: "anthropic:claude-opus-5-5", type: "model" },
      },
    ],
  },
  "runs.createRunOutputSchema": {
    invalid: [
      {
        conversationId: convId,
        runId: runAwaitingApproval.id,
        status: "done",
        streamUrl: "/x",
        userMessageId: msgId,
      },
    ],
    valid: [
      {
        conversationId: convId,
        runId: runAwaitingApproval.id,
        status: "queued",
        streamUrl: `/api/runs/${runAwaitingApproval.id}/stream`,
        userMessageId: msgId,
      },
    ],
  },
  "runs.pendingApprovalSchema": {
    invalid: [{ input: {}, toolCallId: "c", toolName: "edit" }],
    valid:
      runAwaitingApproval.state.status === "awaiting_approval"
        ? runAwaitingApproval.state.approvals
        : [],
  },
  "runs.proposedEditSchema": {
    invalid: [{ hunks: [], patch: "", path: "a" }],
    valid: [
      {
        hunks: [
          { hunkId: "h", newLines: 1, newStart: 1, oldLines: 0, oldStart: 0 },
        ],
        patch: "@@",
        path: "a.ts",
      },
    ],
  },
  "runs.proposedHunkSchema": {
    invalid: [
      { hunkId: "h", newLines: -1, newStart: 1, oldLines: 0, oldStart: 0 },
    ],
    valid: [
      { hunkId: "h", newLines: 1, newStart: 1, oldLines: 0, oldStart: 0 },
    ],
  },
  "runs.reasoningLevelSchema": {
    invalid: ["none", "default", "HIGH", ""],
    valid: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  },
  "runs.runErrorSchema": {
    invalid: [{ code: "oops", message: "x", retryable: false }],
    valid: [
      {
        code: "provider_unavailable",
        message: "No key for anthropic",
        retryable: false,
      },
    ],
  },
  "runs.runInputSchema": {
    invalid: [
      {
        parentId: null,
        parts: [{ text: "x", type: "reasoning" }],
        type: "message",
      },
    ],
    valid: [
      {
        parentId: msgId,
        parts: [{ text: "edit", type: "text" }],
        type: "message",
      },
    ],
  },
  "runs.runOptionsSchema": {
    invalid: [
      { webSearch: "yes" },
      { reasoning: "none" },
      { reasoning: "on" },
      { fast: "yes" },
    ],
    valid: [
      // The shape before 105 still parses.
      {},
      { reasoningEffort: "high", sandbox: "off" },
      { fast: true, reasoning: "xhigh" },
      { fast: false, reasoning: "off", webSearch: "on" },
    ],
  },
  "runs.runSchema": {
    invalid: [
      {
        ...runAwaitingApproval,
        state: { approvals: [], startedAt: t, status: "awaiting_approval" },
      },
      { ...runAwaitingApproval, options: { reasoning: "turbo" } },
    ],
    valid: [
      // Before 105: no options.
      runAwaitingApproval,
      {
        ...runAwaitingApproval,
        options: {
          fast: true,
          reasoning: "high",
          sandbox: "auto",
          webSearch: "auto",
        },
      },
    ],
  },
  "runs.runStateSchema": {
    invalid: [
      { status: "running" },
      { afterRunId: runAwaitingApproval.id, position: 0, status: "queued" },
    ],
    valid: [
      { afterRunId: runAwaitingApproval.id, position: 1, status: "queued" },
      { startedAt: t, status: "running" },
      { finishedAt: t, startedAt: t, status: "succeeded" },
      {
        error: { code: "timeout", message: "Timed out", retryable: true },
        finishedAt: t,
        startedAt: null,
        status: "failed",
      },
      { cancelledBy: null, finishedAt: t, status: "cancelled" },
    ],
  },
  "runs.runTargetSchema": {
    invalid: [{ type: "agent" }, { model: "Bad Model", type: "model" }],
    valid: [
      { id: itemId, type: "agent" },
      { model: "fast", parameters: { temperature: 1 }, type: "model" },
    ],
  },
  "runs.streamChunkSchema": {
    invalid: [{ payload: {}, seq: 0 }],
    valid: [{ payload: { delta: "Hi", id: "t1", type: "text-delta" }, seq: 1 }],
  },
  "runs.streamCursorSchema": { invalid: [-1, 1.5, "3"], valid: [0, 42] },
  "runs.streamUrlSchema": {
    invalid: ["runs/1/stream", "ftp://x/y", "/has space"],
    valid: ["/api/runs/1/stream", "https://worker.example.test/runs/1/stream"],
  },
  "runs.submitApprovalsInputSchema": {
    invalid: [{ decisions: [], runId: runAwaitingApproval.id }],
    valid: [
      {
        decisions: [
          { decision: { decision: "approve" }, toolCallId: "call_2" },
        ],
        runId: runAwaitingApproval.id,
      },
    ],
  },
  "runs.toolApprovalSchema": {
    invalid: [{ decision: { decision: "approve" }, toolCallId: "" }],
    valid: [{ decision: { decision: "reject" }, toolCallId: "call_2" }],
  },

  // sandbox
  "sandbox.deleteFileInputSchema": {
    invalid: [{ conversationId: convId }, { conversationId: convId, path: "" }],
    valid: [
      { conversationId: convId, path: "notes.md" },
      { conversationId: convId, path: "src", recursive: true },
    ],
  },
  "sandbox.execInputSchema": {
    invalid: [{ command: "" }, { command: "ls", timeoutMs: 0 }],
    valid: [{ command: "ls -la", cwd: "/work", env: { A: "1" } }],
  },
  "sandbox.execResultSchema": {
    invalid: [{ durationMs: 1, exitCode: 0, stderr: "", stdout: "" }],
    valid: [
      {
        durationMs: 12,
        exitCode: 0,
        stderr: "",
        stdout: "hi\n",
        timedOut: false,
        truncated: false,
      },
    ],
  },
  "sandbox.fileEntrySchema": {
    invalid: [{ modifiedAt: null, path: "a", size: 1, type: "socket" }],
    valid: [{ modifiedAt: null, path: "a.txt", size: 3, type: "file" }],
  },
  "sandbox.importFileInputSchema": {
    invalid: [
      { conversationId: convId },
      { conversationId: convId, fileId: notUuid },
      { conversationId: convId, fileId: file.id, path: "" },
    ],
    valid: [
      { conversationId: convId, fileId: file.id },
      { conversationId: convId, fileId: file.id, path: "data/report.pdf" },
    ],
  },
  "sandbox.sandboxFileEtagSchema": {
    invalid: ["", "A".repeat(64), "a".repeat(63), `"${"a".repeat(64)}"`],
    valid: [etag],
  },
  "sandbox.sandboxFileWriteSchema": {
    invalid: [
      { path: "a.txt", size: 3 },
      { etag, path: "a.txt", size: -1 },
    ],
    valid: [{ etag, path: "a.txt", size: 3 }],
  },
  "sandbox.sandboxLimitsSchema": {
    invalid: [{ cpu: 0, diskMb: null, memoryMb: 1, network: false }],
    valid: [sandbox.limits],
  },
  "sandbox.sandboxPathSchema": {
    invalid: ["", "x".repeat(4097)],
    valid: ["/work/a.txt", "."],
  },
  "sandbox.sandboxPreviewSchema": {
    invalid: [{ port: 0, url: "https://x.test" }],
    valid: sandbox.previews,
  },
  "sandbox.sandboxSchema": {
    invalid: [{ ...sandbox, status: { state: "failed" } }],
    valid: [sandbox],
  },
  "sandbox.sandboxStatusSchema": {
    invalid: [{ state: "running" }, { state: "failed" }],
    valid: [
      { state: "provisioning" },
      { state: "ready" },
      { message: "OOM", state: "failed" },
    ],
  },
  "sandbox.writeFileInputSchema": {
    invalid: [
      { content: "hi", path: "a.txt" },
      { content: "hi", conversationId: convId, encoding: "hex", path: "a.txt" },
      { content: "hi", conversationId: convId, ifMatch: "v1", path: "a.txt" },
      {
        content: "not base64!",
        conversationId: convId,
        encoding: "base64",
        path: "a.bin",
      },
    ],
    valid: [
      { content: "hi\n", conversationId: convId, path: "a.txt" },
      { content: "", conversationId: convId, ifMatch: null, path: "new.txt" },
      {
        content: "aGk=",
        conversationId: convId,
        encoding: "base64",
        ifMatch: etag,
        path: "a.bin",
      },
    ],
  },

  // search
  "search.highlightSchema": {
    invalid: [{ end: 1, start: -1 }],
    valid: [{ end: 5, start: 0 }],
  },
  "search.searchConversationsInputSchema": {
    invalid: [{ query: " " }],
    valid: [{ query: "billing" }],
  },
  "search.searchHitSchema": {
    invalid: [{ conversationId: convId }],
    valid: [
      {
        conversationId: convId,
        highlights: [{ end: 7, start: 0 }],
        messageId: msgId,
        rank: 0.4,
        role: "user",
        snippet: "billing module",
        title: "Refactor",
        updatedAt: t,
      },
    ],
  },
  "search.webSearchInputSchema": {
    invalid: [{ limit: 50, query: "x" }],
    valid: [{ query: "hono sse" }],
  },
  "search.webSearchResultSchema": {
    invalid: [{ publishedAt: null, snippet: "", title: "", url: "nope" }],
    valid: [
      {
        publishedAt: null,
        snippet: "Streaming helpers",
        title: "Hono",
        url: "https://hono.dev",
      },
    ],
  },

  // tenancy
  "tenancy.chatContextSchema": {
    invalid: [
      { type: "team" },
      { id: notUuid, type: "org" },
      { type: "space" },
    ],
    valid: [
      { type: "personal" },
      { id: teamPlatform.id, type: "team" },
      { id: org.id, type: "org" },
    ],
  },
  "tenancy.instancePolicySchema": {
    invalid: [
      { chatContext: [] },
      { auditPolicy: "maybe" },
      { publishGate: { allowed: [] } },
    ],
    valid: [
      {},
      { chatContext: ["personal"], instanceKeys: { org: true } },
      { persistClientCache: "forbidden" },
    ],
  },
  "tenancy.invitationSchema": {
    invalid: [{}, { token: "short" }],
    valid: [
      {
        createdAt: t,
        email: "bo@example.test",
        expiresAt: t,
        id: fixtureId("invitation", 1),
        invitedBy: uid,
        orgId: org.id,
        role: "member",
        status: "pending",
        teamIds: [teamPlatform.id],
      },
      {
        createdAt: t,
        email: "bo@example.test",
        expiresAt: t,
        id: fixtureId("invitation", 2),
        invitedBy: uid,
        orgId: org.id,
        role: "admin",
        status: "pending",
        teamIds: [],
        token: "k7Qm2c9Xr1VbN0pLw4Ez8TjYs6HgFdAaUoIiPq3Ke5M",
      },
    ],
  },
  "tenancy.invitationTokenSchema": {
    invalid: ["short", "has spaces in it and is long enough to pass min", 42],
    valid: ["k7Qm2c9Xr1VbN0pLw4Ez8TjYs6HgFdAaUoIiPq3Ke5M"],
  },
  "tenancy.orgMemberSchema": {
    invalid: [
      { joinedAt: t, orgId: org.id, role: "guest", teamIds: [], user: userAda },
    ],
    valid: [
      { joinedAt: t, orgId: org.id, role: "admin", teamIds: [], user: userAda },
    ],
  },
  "tenancy.orgPolicySchema": {
    invalid: [{ chatContexts: [] }, { auditEnabled: "yes" }],
    valid: [
      {},
      {
        auditEnabled: true,
        chatContexts: ["team"],
        publishGate: "no-regressions",
      },
      { persistClientCache: false },
    ],
  },
  "tenancy.orgPolicyViewSchema": {
    invalid: [{ effective: {}, limits: {}, stored: {} }],
    valid: [
      {
        adjustments: [
          { field: "auditEnabled", reason: "forbidden_by_instance" },
        ],
        effective: {},
        limits: {},
        stored: { auditEnabled: true },
      },
    ],
  },
  "tenancy.orgSchema": {
    invalid: [
      { ...org, slug: "Bad Slug" },
      { ...org, myRole: "guest" },
    ],
    valid: [org],
  },
  "tenancy.policyAdjustmentSchema": {
    invalid: [{ field: "name", reason: "forbidden_by_instance" }],
    valid: [
      { field: "chatContexts", reason: "not_allowed_by_instance" },
      { field: "persistClientCache", reason: "forbidden_by_instance" },
    ],
  },
  "tenancy.principalSchema": {
    invalid: [{ id: uid, type: "group" }, { type: "user" }],
    valid: [
      { id: uid, type: "user" },
      { id: teamPlatform.id, type: "team" },
    ],
  },
  "tenancy.slugSchema": {
    invalid: ["a", "Has Caps", "-lead", "trail-"],
    valid: ["ab", "example-co"],
  },
  "tenancy.teamMemberSchema": {
    invalid: [
      { addedAt: t, role: "owner", teamId: teamPlatform.id, user: userAda },
    ],
    valid: [
      { addedAt: t, role: "member", teamId: teamPlatform.id, user: userAda },
    ],
  },
  "tenancy.teamSchema": {
    invalid: [{ ...teamPlatform, parentId: notUuid }],
    valid: [teamPlatform],
  },
  "tenancy.userSummarySchema": {
    invalid: [{ ...userAda, email: "nope" }],
    valid: [userAda, { ...userAda, email: null }],
  },

  // usage
  "usage.budgetSchema": {
    invalid: [{ hard: true, limitMicros: -1 }],
    valid: [
      {
        hard: true,
        id: fixtureId("budget", 1),
        limitMicros: 50_000_000,
        period: "month",
        principal: { id: teamPlatform.id, type: "team" },
        resetsAt: t,
        usedMicros: 1_250_000,
      },
    ],
  },
  "usage.listBudgetsInputSchema": { invalid: [{}], valid: [{ orgId: org.id }] },
  "usage.listTransactionsInputSchema": {
    invalid: [{ principalId: uid, principalType: "role" }],
    valid: [{ principalId: uid, principalType: "user" }],
  },
  "usage.setBudgetInputSchema": {
    invalid: [
      {
        limitMicros: 1,
        orgId: notUuid,
        period: "month",
        principal: { id: uid, type: "user" },
      },
      {
        limitMicros: 1.5,
        period: "month",
        principal: { id: uid, type: "user" },
      },
    ],
    valid: [
      {
        limitMicros: 5_000_000,
        period: "week",
        principal: { id: uid, type: "user" },
      },
      {
        limitMicros: 5_000_000,
        orgId: org.id,
        period: "week",
        principal: { id: uid, type: "user" },
      },
    ],
  },
  "usage.transactionSchema": {
    invalid: [{ costMicros: 1 }],
    valid: [
      {
        context: conversation.context,
        costMicros: 1234,
        createdAt: t,
        id: fixtureId("transaction", 1),
        kind: "chat",
        model: "anthropic:claude-opus-5-5",
        paidBy: { id: teamEngineering.id, type: "team" },
        runId: runAwaitingApproval.id,
        usage: { inputTokens: 10, outputTokens: 5 },
        userId: uid,
      },
    ],
  },
  "usage.usageSummaryInputSchema": {
    invalid: [{ from: t, principalId: uid, principalType: "user" }],
    valid: [
      {
        from: t,
        groupBy: "day",
        principalId: org.id,
        principalType: "org",
        to: t,
      },
    ],
  },
  "usage.usageSummarySchema": {
    invalid: [
      { from: t, principal: { id: uid, type: "user" }, rows: [], to: t },
    ],
    valid: [
      {
        from: t,
        principal: { id: uid, type: "user" },
        rows: [
          {
            costMicros: 10,
            key: "anthropic:claude-opus-5-5",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ],
        to: t,
        totalCostMicros: 10,
      },
    ],
  },
};

// ids are `idSchema(kind)`: UUID strings with a "(UUIDv7)" description.
const isIdSchema = (schema: z.ZodType) =>
  schema.description?.endsWith("id (UUIDv7)") ?? false;

/** Schemas that can't round-trip through JSON; each has its own test below. */
const testedSeparately = new Set(["files.uploadFileInputSchema"]);

const casesFor = (key: string, schema: z.ZodType): Cases | undefined => {
  const explicit = cases[key];
  if (explicit) {
    return explicit;
  }
  if (schema instanceof z.ZodEnum) {
    return { invalid: ["__not_an_option__", 1, null], valid: schema.options };
  }
  if (isIdSchema(schema)) {
    return { invalid: [notUuid, "", 42], valid: [fixtureId("any", 7)] };
  }
};

const allSchemas = Object.entries(modules).flatMap(([module, exports]) =>
  Object.entries(exports)
    .filter(
      (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType
    )
    .map(([name, schema]) => ({ key: `${module}.${name}`, schema }))
);

describe("contract schemas", () => {
  it("has round-trip cases for every exported schema", () => {
    const missing = allSchemas
      .filter(
        ({ key, schema }) =>
          !(casesFor(key, schema) || testedSeparately.has(key))
      )
      .map(({ key }) => key);
    expect(missing).toEqual([]);
  });

  it("has no cases for schemas that no longer exist", () => {
    const known = new Set(allSchemas.map(({ key }) => key));
    expect(Object.keys(cases).filter((key) => !known.has(key))).toEqual([]);
  });

  for (const { key, schema } of allSchemas) {
    const found = casesFor(key, schema);
    if (!found) {
      continue;
    }
    describe(key, () => {
      it.each(found.valid.map((value, index) => [index, value]))(
        "round-trips valid sample %i",
        (_index, value) => {
          const parsed = schema.parse(value);
          const again = schema.parse(JSON.parse(JSON.stringify(parsed)));
          expect(again).toEqual(parsed);
        }
      );
      it.each(found.invalid.map((value, index) => [index, value]))(
        "rejects invalid sample %i",
        (_index, value) => {
          expect(schema.safeParse(value).success).toBe(false);
        }
      );
    });
  }
});

describe("file upload input", () => {
  // `z.file()` can't go through JSON, so it's checked on its own.
  it("accepts a File and applies the default purpose", () => {
    const parsed = modules.files.uploadFileInputSchema.parse({
      file: new File(["hi"], "a.txt", { type: "text/plain" }),
    });
    expect(parsed.purpose).toBe("attachment");
  });

  it("rejects a missing or non-File body", () => {
    expect(modules.files.uploadFileInputSchema.safeParse({}).success).toBe(
      false
    );
    expect(
      modules.files.uploadFileInputSchema.safeParse({ file: "a.txt" }).success
    ).toBe(false);
  });
});

describe("workspace file writes", () => {
  const { SANDBOX_WRITE_MAX_BYTES, writeFileInputSchema } = modules.sandbox;
  const write = (content: string, encoding: "base64" | "utf8") =>
    writeFileInputSchema.safeParse({
      content,
      conversationId: convId,
      encoding,
      path: "big.bin",
    }).success;
  // Base64 of `bytes` zero bytes, without building the buffer.
  const base64Of = (bytes: number) => {
    const tail = bytes % 3;
    const full = "A".repeat(Math.floor(bytes / 3) * 4);
    if (tail === 0) {
      return full;
    }
    return tail === 1 ? `${full}AA==` : `${full}AAA=`;
  };

  it("caps the decoded size, not the encoded length", () => {
    expect(write(base64Of(SANDBOX_WRITE_MAX_BYTES), "base64")).toBe(true);
    expect(write(base64Of(SANDBOX_WRITE_MAX_BYTES + 1), "base64")).toBe(false);
    expect(write("a".repeat(SANDBOX_WRITE_MAX_BYTES), "utf8")).toBe(true);
    expect(write("a".repeat(SANDBOX_WRITE_MAX_BYTES + 1), "utf8")).toBe(false);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // "é" is two bytes, so half the cap in characters fills it.
    const half = SANDBOX_WRITE_MAX_BYTES / 2;
    expect(write("é".repeat(half), "utf8")).toBe(true);
    expect(write("é".repeat(half + 1), "utf8")).toBe(false);
  });

  it("defaults to UTF-8 and leaves ifMatch unset (overwrite)", () => {
    const parsed = writeFileInputSchema.parse({
      content: "hi",
      conversationId: convId,
      path: "a.txt",
    });
    expect(parsed.encoding).toBe("utf8");
    expect(parsed).not.toHaveProperty("ifMatch");
  });
});

describe("model refs", () => {
  it("splits refs and leaves aliases alone", () => {
    expect(modules.models.parseModelRef("ollama:llama3.2:3b")).toEqual({
      modelId: "llama3.2:3b",
      provider: "ollama",
    });
    expect(modules.models.parseModelRef("fast")).toBeUndefined();
  });
});

describe("model proxy request", () => {
  it("drops call options the proxy doesn't take", () => {
    // A client forwards its AI SDK call options whole; these must not reach a provider.
    const parsed = modules.llm.llmProxyRequestSchema.parse({
      ...llmProxyRequest,
      headers: { authorization: "Bearer from-the-client" },
      includeRawChunks: true,
    });
    expect(parsed).not.toHaveProperty("headers");
    expect(parsed).not.toHaveProperty("includeRawChunks");
  });
});

describe("run and library helpers", () => {
  it("knows which run statuses are terminal", () => {
    expect(
      modules.runs.runStatusSchema.options.filter(
        modules.runs.isTerminalRunStatus
      )
    ).toEqual(["succeeded", "failed", "cancelled"]);
  });

  it("knows which library kinds are versioned", () => {
    expect(
      modules.library.libraryKindSchema.options.filter(
        modules.library.isVersionedLibraryKind
      )
    ).toEqual(["agent", "prompt", "skill"]);
  });

  it("covers every part type in the fixtures", () => {
    const types = new Set(allMessageParts.map((part) => part.type));
    expect([...types].sort()).toEqual(
      modules.messageParts.messagePartSchema.options
        .map((o) => o.shape.type.value)
        .sort()
    );
  });
});
