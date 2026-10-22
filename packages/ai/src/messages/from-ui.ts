import type { UserId } from "@workspace/contract/schemas/common";
import {
  type ApprovalDecision,
  type ApprovalState,
  annotationRefPartSchema,
  artifactRefPartSchema,
  citationSchema,
  type fileSourceSchema,
  type MessagePart,
  messagePartSchema,
} from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";
import {
  type DynamicToolUIPart,
  type FileUIPart,
  getToolOrDynamicToolName,
  isToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { z } from "zod";

import {
  ANNOTATION_REF_DATA,
  ARTIFACT_REF_DATA,
  CITATION_METADATA_KEY,
} from "./to-ui";

// A finished AI SDK `UIMessage` (the run stream, read back by
// `readUIMessageStream`) to our stored `MessagePart`s. Tool parts split into a
// `tool-call` and, once there's output, a `tool-result`. Approval decisions
// come from the run (who decided, when, and the full per-hunk review), not
// from the stream, which only knows yes or no.
//
// Dropped on purpose: `custom` and `reasoning-file` parts (provider-specific,
// nothing renders them) and tool calls still streaming their input.

export interface RecordedDecision {
  readonly decidedAt: Date | string;
  readonly decidedBy: UserId;
  readonly decision: ApprovalDecision;
}

export interface FromUIOptions {
  /** The decision an approver made for a call, if any. */
  readonly decisionFor: (toolCallId: string) => RecordedDecision | undefined;
  /** Maps a file part's URL back to an uploaded file; default keeps the URL. */
  readonly fileSource?: (part: FileUIPart) => z.infer<typeof fileSourceSchema>;
  /** When pending approvals were requested. */
  readonly now: () => Date;
}

export const fromUIErrorSchema = z.discriminatedUnion("type", [
  /** A person approved or denied a call but the run has no record of it. */
  z.object({ toolCallId: z.string(), type: z.literal("missing_decision") }),
  /** The mapped parts don't fit the contract (say, non-JSON tool output). */
  z.object({ message: z.string(), type: z.literal("invalid_part") }),
]);
export type FromUIError = z.infer<typeof fromUIErrorSchema>;

type ToolPart = ToolUIPart | DynamicToolUIPart;

const toIso = (value: Date | string): string =>
  typeof value === "string" ? value : value.toISOString();

const withoutKey = (
  metadata: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return;
  }
  const { [key]: _removed, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : undefined;
};

const callApproval = (
  part: ToolPart,
  { decisionFor, now }: FromUIOptions
): Result<ApprovalState, FromUIError> => {
  if (part.state === "approval-requested") {
    return ok({ requestedAt: now().toISOString(), state: "pending" });
  }
  // Policy approvals and denials (`isAutomatic`) never waited on a person.
  if (!part.approval || part.approval.isAutomatic) {
    return ok({ state: "not-required" });
  }
  const recorded = decisionFor(part.toolCallId);
  if (!recorded) {
    return err({ toolCallId: part.toolCallId, type: "missing_decision" });
  }
  return ok({
    decidedAt: toIso(recorded.decidedAt),
    decidedBy: recorded.decidedBy,
    decision: recorded.decision,
    state: "decided",
  });
};

/**
 * The call's input. A call the SDK refused (bad input, or a tool the run
 * doesn't have) ends as `output-error` with what the model sent in
 * `rawInput` and no `input`, which is still what the call was.
 */
const inputOf = (part: ToolPart): unknown => {
  if (part.state !== "output-error" || part.input !== undefined) {
    return part.input;
  }
  return "rawInput" in part ? (part.rawInput ?? null) : null;
};

const toolParts = (
  part: ToolPart,
  options: FromUIOptions
): Result<readonly unknown[], FromUIError> => {
  if (part.state === "input-streaming") {
    return ok([]);
  }
  const approval = callApproval(part, options);
  if (!approval.ok) {
    return approval;
  }
  const toolName = getToolOrDynamicToolName(part);
  const call = {
    approval: approval.value,
    input: inputOf(part),
    providerExecuted: part.providerExecuted,
    providerMetadata: part.callProviderMetadata,
    toolCallId: part.toolCallId,
    toolName,
    type: "tool-call",
  };
  const result = (output: unknown) => [
    call,
    {
      output,
      providerMetadata:
        "resultProviderMetadata" in part
          ? part.resultProviderMetadata
          : undefined,
      toolCallId: part.toolCallId,
      toolName,
      type: "tool-result",
    },
  ];
  switch (part.state) {
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return ok([call]);
    case "output-available":
      return ok(result({ status: "success", value: part.output }));
    case "output-error":
      return ok(result({ message: part.errorText, status: "error" }));
    case "output-denied": {
      const recorded = options.decisionFor(part.toolCallId)?.decision;
      const decision: ApprovalDecision = recorded ?? {
        decision: "reject",
        reason: part.approval.reason,
      };
      return ok(result({ decision, status: "denied" }));
    }
    default:
      return part satisfies never;
  }
};

const dataPart = (
  name: string,
  id: string | undefined,
  data: unknown
): unknown => {
  if (name === ARTIFACT_REF_DATA) {
    const ref = artifactRefPartSchema.safeParse({
      ...(data as object),
      type: "artifact-ref",
    });
    if (ref.success) {
      return ref.data;
    }
  }
  if (name === ANNOTATION_REF_DATA) {
    const ref = annotationRefPartSchema.safeParse({
      ...(data as object),
      type: "annotation-ref",
    });
    if (ref.success) {
      return ref.data;
    }
  }
  return { data, id, name, type: "data" };
};

const defaultFileSource = (part: FileUIPart) => ({
  kind: "url" as const,
  url: part.url,
});

export const fromUIMessage = (
  message: Pick<UIMessage, "parts">,
  options: FromUIOptions
): Result<MessagePart[], FromUIError> => {
  const mapped: unknown[] = [];
  for (const part of message.parts) {
    if (isToolUIPart(part)) {
      const parts = toolParts(part, options);
      if (!parts.ok) {
        return parts;
      }
      mapped.push(...parts.value);
      continue;
    }
    switch (part.type) {
      case "text":
        mapped.push({
          providerMetadata: part.providerMetadata,
          text: part.text,
          type: "text",
        });
        break;
      case "reasoning":
        mapped.push({
          providerMetadata: part.providerMetadata,
          text: part.text,
          type: "reasoning",
        });
        break;
      case "file":
        mapped.push({
          filename: part.filename,
          mediaType: part.mediaType,
          providerMetadata: part.providerMetadata,
          source: (options.fileSource ?? defaultFileSource)(part),
          type: "file",
        });
        break;
      case "source-url":
        mapped.push({
          id: part.sourceId,
          providerMetadata: part.providerMetadata,
          source: { kind: "url", title: part.title, url: part.url },
          type: "source",
        });
        break;
      case "source-document": {
        const citation = citationSchema.safeParse(
          part.providerMetadata?.[CITATION_METADATA_KEY]
        );
        // A provider's own document citation has no file row behind it;
        // keep it as data rather than invent one.
        mapped.push(
          citation.success
            ? {
                id: part.sourceId,
                providerMetadata: withoutKey(
                  part.providerMetadata,
                  CITATION_METADATA_KEY
                ),
                source: citation.data,
                type: "source",
              }
            : {
                data: {
                  filename: part.filename ?? null,
                  mediaType: part.mediaType,
                  sourceId: part.sourceId,
                  title: part.title,
                },
                name: "source-document",
                type: "data",
              }
        );
        break;
      }
      case "step-start":
        mapped.push({ type: "step-start" });
        break;
      case "custom":
      case "reasoning-file":
        break;
      default:
        if (part.type.startsWith("data-")) {
          const data = part as { data: unknown; id?: string; type: string };
          mapped.push(
            dataPart(part.type.slice("data-".length), data.id, data.data)
          );
        }
    }
  }
  // Parts are stored as JSON, so they're checked as JSON: an SDK's own
  // objects carry `undefined` fields (Anthropic's tool-call `caller`) that
  // storage drops anyway.
  const parsed = z
    .array(messagePartSchema)
    .safeParse(JSON.parse(JSON.stringify(mapped)));
  if (!parsed.success) {
    return err({
      message: z.prettifyError(parsed.error),
      type: "invalid_part",
    });
  }
  return ok(parsed.data);
};
