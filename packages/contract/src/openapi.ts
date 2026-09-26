import { type OpenAPI, OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { contract } from "./contract";
import { jsonValueSchema, providerMetadataSchema } from "./schemas/common";
import {
  conversationSchema,
  participantStateSchema,
} from "./schemas/conversations";
import {
  artifactSchema,
  artifactVersionSchema,
  fileSchema,
} from "./schemas/files";
import { resourceGrantSchema, shareLinkSchema } from "./schemas/grants";
import { providerKeySchema } from "./schemas/keys";
import {
  libraryDefinitionInputSchema,
  libraryDefinitionSchema,
  libraryExportSchema,
  libraryItemDetailSchema,
  libraryItemSchema,
  libraryVersionSchema,
} from "./schemas/library";
import { memoryDocumentSchema, memoryVersionSchema } from "./schemas/memory";
import {
  approvalDecisionSchema,
  messagePartSchema,
  userMessagePartSchema,
} from "./schemas/message-parts";
import { messageSchema } from "./schemas/messages";
import { runSchema, runStateSchema, runTargetSchema } from "./schemas/runs";
import { sandboxSchema } from "./schemas/sandbox";
import {
  chatContextSchema,
  orgPolicySchema,
  orgSchema,
  principalSchema,
  teamSchema,
  userSummarySchema,
} from "./schemas/tenancy";
import { budgetSchema, transactionSchema } from "./schemas/usage";

// OpenAPI 3.1 from the contract (D26), for the Swift client, Scalar and the
// docs site. Everything comes from the oRPC contract except the run stream,
// which is SSE and added by hand below so non-TypeScript clients can find it.

/** The API version: bump the major on a breaking contract change. */
export const API_VERSION = "0.1.0";

const tags = Object.entries({
  Account: "The signed-in user and their settings.",
  Admin: "Instance administration.",
  Artifacts: "Artifacts produced in conversations, with versions.",
  Conversations: "Conversations, chat context and per-user state.",
  Feedback: "Thumbs up/down on assistant messages.",
  Files: "Uploads, ingestion and semantic file search.",
  Keys: "Org, team and user provider keys (write-only).",
  Library: "Agents, prompts, skills, MCP servers and presets.",
  MCP: "Live state of MCP servers in the library.",
  Memory: "The user's Markdown memory file and its versions.",
  Messages: "The message tree and branches.",
  Meta: "Public instance config and the model picker.",
  Orgs: "Orgs, members, invitations and org policy.",
  Runs: "Chat turns: create, stream, approve, cancel.",
  Sandbox: "Per-conversation sandboxes.",
  Search: "Full-text search over conversations.",
  Sharing: "Grants (share) and public share links.",
  Teams: "The team tree and team membership.",
  Usage: "Usage, transactions and budgets.",
}).map(([name, description]) => ({ description, name }));

const errorResponse = (description: string, code: string) => ({
  content: {
    "application/json": {
      schema: {
        oneOf: [
          { $ref: `#/components/schemas/${code}Error` },
          { $ref: "#/components/schemas/UndefinedError" },
        ],
      },
    },
  },
  description,
});

/** `GET /runs/{id}/stream`: not an oRPC procedure, documented here for OpenAPI clients. */
const runStreamPath: OpenAPI.PathItemObject = {
  get: {
    description: [
      "Streams a run as Server-Sent Events using the AI SDK UI message stream protocol",
      "(header `x-vercel-ai-ui-message-stream: v1`). Each event's `data` is one JSON",
      "`UIMessageChunk` and its `id` is the chunk's sequence number; the stream ends",
      "with `data: [DONE]`. Reconnect with `?cursor=<last id>` or a `Last-Event-ID`",
      "header to resume without gaps or repeats. A finished run replays and closes.",
    ].join(" "),
    operationId: "runs.stream",
    parameters: [
      {
        in: "path",
        name: "id",
        required: true,
        schema: { format: "uuid", type: "string" },
      },
      {
        description:
          "The last sequence number received; 0 replays from the start.",
        in: "query",
        name: "cursor",
        required: false,
        schema: { minimum: 0, type: "integer" },
      },
      {
        description:
          "Standard SSE resume header; `cursor` wins if both are sent.",
        in: "header",
        name: "Last-Event-ID",
        required: false,
        schema: { type: "string" },
      },
    ],
    responses: {
      "200": {
        content: {
          "text/event-stream": {
            schema: {
              description:
                "`id: <seq>` and `data: <UIMessageChunk JSON>` events, then `data: [DONE]`.",
              type: "string",
            },
          },
        },
        description: "The event stream.",
        headers: {
          "x-vercel-ai-ui-message-stream": {
            description: "Protocol version.",
            schema: { enum: ["v1"], type: "string" },
          },
        },
      },
      "401": errorResponse("Not signed in.", "UNAUTHORIZED"),
      "403": errorResponse("No access to the conversation.", "FORBIDDEN"),
      "404": errorResponse("No such run.", "NOT_FOUND"),
    },
    summary: "Stream a run (SSE)",
    tags: ["Runs"],
  },
};

/**
 * Shared shapes become `components.schemas` entries and are referenced by
 * `$ref`, which keeps the document small and gives generated clients (Swift)
 * named types. Only schemas whose input and output JSON Schema agree belong
 * here; the rest are inlined per operation.
 */
const commonSchemas = {
  ApprovalDecision: { schema: approvalDecisionSchema },
  Artifact: { schema: artifactSchema },
  ArtifactVersion: { schema: artifactVersionSchema },
  Budget: { schema: budgetSchema },
  ChatContext: { schema: chatContextSchema },
  Conversation: { schema: conversationSchema },
  File: { schema: fileSchema },
  LibraryDefinition: { schema: libraryDefinitionSchema },
  LibraryDefinitionInput: { schema: libraryDefinitionInputSchema },
  LibraryExport: { schema: libraryExportSchema },
  LibraryItem: { schema: libraryItemSchema },
  LibraryItemDetail: { schema: libraryItemDetailSchema },
  LibraryVersion: { schema: libraryVersionSchema },
  MemoryDocument: { schema: memoryDocumentSchema },
  MemoryVersion: { schema: memoryVersionSchema },
  Message: { schema: messageSchema },
  MessagePart: { schema: messagePartSchema },
  Org: { schema: orgSchema },
  OrgPolicy: { schema: orgPolicySchema },
  ParticipantState: { schema: participantStateSchema },
  Principal: { schema: principalSchema },
  ProviderKey: { schema: providerKeySchema },
  ProviderMetadata: { schema: providerMetadataSchema },
  ResourceGrant: { schema: resourceGrantSchema },
  Run: { schema: runSchema },
  RunState: { schema: runStateSchema },
  RunTarget: { schema: runTargetSchema },
  Sandbox: { schema: sandboxSchema },
  ShareLink: { schema: shareLinkSchema },
  Team: { schema: teamSchema },
  Transaction: { schema: transactionSchema },
  UndefinedError: { error: "UndefinedError" as const },
  UserMessagePart: { schema: userMessagePartSchema },
  UserSummary: { schema: userSummarySchema },
};

type JsonObject = Record<string, unknown>;

/** The body of one defined error code, as oRPC sends it. */
const definedErrorSchema = (
  code: string,
  status: number,
  message: string,
  dataRequired: boolean,
  data: unknown
): JsonObject => ({
  properties: {
    code: { const: code },
    data,
    defined: { const: true },
    message: { default: message, type: "string" },
    status: { const: status },
  },
  required: [
    "defined",
    "code",
    "status",
    "message",
    ...(dataRequired ? ["data"] : []),
  ],
  type: "object",
});

const HTTP_METHODS = ["get", "put", "post", "delete", "patch"] as const;

/**
 * oRPC describes a `z.void()` output as a JSON body that can't exist. A 204
 * has no body, so drop the content and keep the description.
 */
const withoutNoContentBodies = (
  paths: OpenAPI.PathsObject
): OpenAPI.PathsObject =>
  Object.fromEntries(
    Object.entries(paths).map(([path, item]) => {
      if (!item) {
        return [path, item];
      }
      const next: OpenAPI.PathItemObject = { ...item };
      for (const method of HTTP_METHODS) {
        const operation = item[method];
        const noContent = operation?.responses?.["204"];
        if (operation && noContent && !("$ref" in noContent)) {
          next[method] = {
            ...operation,
            responses: {
              ...operation.responses,
              "204": { description: "No content." },
            },
          };
        }
      }
      return [path, next];
    })
  );

/** Builds the OpenAPI document. Pure apart from the generator's own async work. */
export const generateOpenApi = async (): Promise<OpenAPI.Document> => {
  const generator = new OpenAPIGenerator({
    schemaConverters: [
      new ZodToJsonSchemaConverter({
        // `z.json()` is recursive; spelled out it bloats every schema that
        // carries tool input or metadata. In OpenAPI it's just "any JSON".
        interceptors: [
          ({ next, schema }) =>
            schema === jsonValueSchema
              ? [true, { description: "Any JSON value." }]
              : next(),
        ],
      }),
    ],
  });
  // oRPC inlines every error body into every operation, which is most of the
  // document. Name each code once instead and reference it; the bodies are
  // collected here and added to `components.schemas` below.
  const errorSchemas = new Map<string, JsonObject>();
  const document = await generator.generate(contract, {
    commonSchemas,
    components: {
      securitySchemes: {
        bearer: {
          description:
            "A session token from Better Auth's `bearer()` plugin (mobile, Swift).",
          scheme: "bearer",
          type: "http",
        },
        session: {
          description: "The Better Auth session cookie (web, desktop).",
          in: "cookie",
          name: "better-auth.session_token",
          type: "apiKey",
        },
      },
    },
    customErrorResponseBodySchema: (definedErrors, status) => ({
      oneOf: [
        ...definedErrors.map(([code, message, dataRequired, data]) => {
          const name = `${code}Error`;
          errorSchemas.set(
            name,
            definedErrorSchema(code, status, message, dataRequired, data)
          );
          return { $ref: `#/components/schemas/${name}` };
        }),
        { $ref: "#/components/schemas/UndefinedError" },
      ],
    }),
    info: {
      description:
        "The HTTP API behind every client. Generated from the oRPC contract in `packages/contract`; do not edit by hand.",
      title: "API",
      version: API_VERSION,
    },
    security: [{ session: [] }, { bearer: [] }],
    servers: [{ description: "Same origin as the web app", url: "/api" }],
    tags,
  });
  const sortedErrors = Object.fromEntries(
    [...errorSchemas].sort(([a], [b]) => a.localeCompare(b))
  );
  return {
    ...document,
    components: {
      ...document.components,
      schemas: { ...document.components?.schemas, ...sortedErrors },
    },
    paths: {
      ...withoutNoContentBodies(document.paths ?? {}),
      "/runs/{id}/stream": runStreamPath,
    },
  };
};

/** Stable text for the committed file: two-space JSON and a trailing newline. */
export const serializeOpenApi = (document: unknown): string =>
  `${JSON.stringify(document, null, 2)}\n`;
