import type { FileId } from "@workspace/contract/schemas/common";
import type {
  MessagePart,
  toolCallPartSchema,
  toolResultPartSchema,
} from "@workspace/contract/schemas/message-parts";
import type { MessageRole } from "@workspace/contract/schemas/messages";
import type {
  ProviderMetadata,
  UIMessage,
  UIMessagePart,
  UITool,
  UIToolInvocation,
  UITools,
} from "ai";
import type { z } from "zod";

import { approvalIdFor, approvalReason, isApproved } from "./approval";

// Our stored `MessagePart`s (partsVersion 1) to AI SDK `UIMessage`s: for the
// client's first render, and for `convertToModelMessages` when a run builds
// its prompt. The reverse is `fromUIMessage`; a round trip is lossless for
// every part a run can produce.
//
// The AI SDK keeps a tool call and its result in one part whose `state` walks
// input → approval → output. We store them as two parts joined by
// `toolCallId`, possibly in different messages (a result can land after an
// approval), so results are joined to their calls across the whole list.

type ToolCallPart = z.infer<typeof toolCallPartSchema>;
type ToolResultPart = z.infer<typeof toolResultPartSchema>;
type UIPart = UIMessagePart<Record<string, unknown>, UITools>;

export interface StoredMessage {
  readonly id: string;
  readonly parts: readonly MessagePart[];
  readonly role: MessageRole;
}

export interface ToUIOptions {
  /** Where a client (or provider) can fetch an uploaded file's bytes. */
  readonly fileUrl: (fileId: FileId) => string;
}

/** providerMetadata key under which a file citation rides on a `source-document`. */
export const CITATION_METADATA_KEY = "citation";

/** Our reference parts travel as data parts under these names. */
export const ARTIFACT_REF_DATA = "artifact-ref";
export const ANNOTATION_REF_DATA = "annotation-ref";

/** Drops `undefined` values, so parts serialize the same as they compare. */
const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;

const toolInvocation = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): UIToolInvocation<UITool> => {
  const base = {
    callProviderMetadata: call.providerMetadata as ProviderMetadata | undefined,
    input: call.input,
    providerExecuted: call.providerExecuted,
    toolCallId: call.toolCallId,
  };
  const id = approvalIdFor(call.toolCallId);
  const { approval } = call;
  // Present only when a human said yes; the SDK's types pin `approved: true`
  // on anything that produced output.
  const approvedBy =
    approval.state === "decided" && isApproved(approval.decision)
      ? compact({
          approved: true as const,
          id,
          reason: approvalReason(approval.decision),
        })
      : undefined;

  if (result) {
    const resultProviderMetadata = result.providerMetadata as
      | ProviderMetadata
      | undefined;
    switch (result.output.status) {
      case "success":
        return compact({
          ...base,
          approval: approvedBy,
          output: result.output.value,
          resultProviderMetadata,
          state: "output-available" as const,
        });
      case "error":
        return compact({
          ...base,
          approval: approvedBy,
          errorText: result.output.message,
          resultProviderMetadata,
          state: "output-error" as const,
        });
      case "denied":
        return compact({
          ...base,
          approval: compact({
            approved: false as const,
            id,
            // A denial nobody decided came from policy, not a person.
            isAutomatic: approval.state === "decided" ? undefined : true,
            reason: approvalReason(result.output.decision),
          }),
          state: "output-denied" as const,
        });
      default:
        return result.output satisfies never;
    }
  }

  switch (approval.state) {
    case "not-required":
      return compact({ ...base, state: "input-available" as const });
    case "pending":
      return compact({
        ...base,
        approval: { id },
        state: "approval-requested" as const,
      });
    case "decided":
      return compact({
        ...base,
        approval: compact({
          approved: isApproved(approval.decision),
          id,
          reason: approvalReason(approval.decision),
        }),
        state: "approval-responded" as const,
      });
    default:
      return approval satisfies never;
  }
};

const toUIPart = (
  part: MessagePart,
  results: ReadonlyMap<string, ToolResultPart>,
  { fileUrl }: ToUIOptions
): UIPart | undefined => {
  const providerMetadata = (
    "providerMetadata" in part ? part.providerMetadata : undefined
  ) as ProviderMetadata | undefined;
  switch (part.type) {
    case "text":
      return compact({
        providerMetadata,
        text: part.text,
        type: "text" as const,
      });
    case "reasoning":
      return compact({
        providerMetadata,
        text: part.text,
        type: "reasoning" as const,
      });
    case "file":
      return compact({
        filename: part.filename,
        mediaType: part.mediaType,
        providerMetadata,
        type: "file" as const,
        url:
          part.source.kind === "url"
            ? part.source.url
            : fileUrl(part.source.fileId),
      });
    case "source": {
      const { source } = part;
      if (source.kind === "url") {
        return compact({
          providerMetadata,
          sourceId: part.id,
          title: source.title,
          type: "source-url" as const,
          url: source.url,
        });
      }
      return compact({
        filename: source.filename,
        mediaType: "application/octet-stream",
        providerMetadata: {
          ...providerMetadata,
          [CITATION_METADATA_KEY]: source,
        },
        sourceId: part.id,
        title: source.title ?? source.filename ?? "",
        type: "source-document" as const,
      });
    }
    case "tool-call":
      return {
        type: `tool-${part.toolName}`,
        ...toolInvocation(part, results.get(part.toolCallId)),
      } as UIPart;
    case "tool-result":
      // Folded into its call; see `toUIMessages`.
      return;
    case "artifact-ref": {
      const { type: _type, ...data } = part;
      return { data, type: `data-${ARTIFACT_REF_DATA}` };
    }
    case "annotation-ref": {
      const { type: _type, ...data } = part;
      return { data, type: `data-${ANNOTATION_REF_DATA}` };
    }
    case "data":
      return compact({
        data: part.data,
        id: part.id,
        type: `data-${part.name}` as const,
      });
    case "step-start":
      return { type: "step-start" };
    default:
      return part satisfies never;
  }
};

export const toUIMessages = (
  messages: readonly StoredMessage[],
  options: ToUIOptions
): UIMessage[] => {
  const results = new Map<string, ToolResultPart>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-result") {
        results.set(part.toolCallId, part);
      }
    }
  }
  return messages.map((message) => ({
    id: message.id,
    parts: message.parts.flatMap(
      (part) => toUIPart(part, results, options) ?? []
    ),
    role: message.role,
  }));
};
