import { memoryVersionIdSchema } from "@workspace/contract/schemas/common";
import type {
  annotationRefPartSchema,
  artifactRefPartSchema,
  filePartSchema,
  MessagePart,
  sourcePartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
} from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { ToolUIPart } from "ai";
import { z } from "zod";

import {
  PLAN_DATA,
  type PlanApprovalRef,
  type PlanRef,
  planApprovalOf,
  planRefSchema,
} from "./plan";

// How a message's stored parts (partsVersion 1) become what the conversation
// renders. Tool calls and their results are separate parts joined by
// `toolCallId`, possibly in different messages (a result can land after an
// approval), so results are indexed across the whole branch first.

export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type ToolResultPart = z.infer<typeof toolResultPartSchema>;
export type FilePart = z.infer<typeof filePartSchema>;
export type SourcePart = z.infer<typeof sourcePartSchema>;
export type ArtifactRefPart = z.infer<typeof artifactRefPartSchema>;
export type AnnotationRefPart = z.infer<typeof annotationRefPartSchema>;

export type ToolResultIndex = ReadonlyMap<string, ToolResultPart>;

/** Every tool result on the branch, by the call it answers. */
export const indexToolResults = (
  messages: readonly Pick<Message, "parts">[]
): ToolResultIndex => {
  const index = new Map<string, ToolResultPart>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-result") {
        index.set(part.toolCallId, part);
      }
    }
  }
  return index;
};

/** The AI Elements tool badge state for a call and its result, if any. */
export const toolViewState = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): ToolUIPart["state"] => {
  if (result) {
    switch (result.output.status) {
      case "success":
        return "output-available";
      case "error":
        return "output-error";
      case "denied":
        return "output-denied";
      default:
        return result.output satisfies never;
    }
  }
  switch (call.approval.state) {
    case "pending":
      return "approval-requested";
    case "decided":
      return "approval-responded";
    case "not-required":
      return "input-available";
    default:
      return call.approval satisfies never;
  }
};

/** The agent's memory tool (D20; ticket 022). */
export const MEMORY_TOOL_NAME = "update_memory";

/**
 * What the "Memory updated · Undo" note needs. From the `update_memory`
 * tool's `applied` result, where `previousVersionId` is always present
 * (`null` for the first write); a `memory-update` data part may omit it, and
 * then there's nothing safe to undo to.
 */
export const memoryUpdateSchema = z.object({
  previousVersionId: memoryVersionIdSchema.nullable().optional(),
  summary: z.string().min(1),
  versionId: memoryVersionIdSchema,
});
export type MemoryUpdate = z.infer<typeof memoryUpdateSchema>;

const appliedMemoryResultSchema = memoryUpdateSchema.extend({
  previousVersionId: memoryVersionIdSchema.nullable(),
  status: z.literal("applied"),
});

const memoryFromResult = (
  result: ToolResultPart | undefined
): MemoryUpdate | null => {
  if (result?.output.status !== "success") {
    return null;
  }
  const parsed = appliedMemoryResultSchema.safeParse(result.output.value);
  return parsed.success
    ? {
        previousVersionId: parsed.data.previousVersionId,
        summary: parsed.data.summary,
        versionId: parsed.data.versionId,
      }
    : null;
};

/** One thing the message renders, in part order. */
export type RenderBlock =
  | { readonly key: string; readonly kind: "text"; readonly text: string }
  | { readonly key: string; readonly kind: "reasoning"; readonly text: string }
  | {
      readonly call: ToolCallPart;
      readonly key: string;
      readonly kind: "tool";
      readonly result: ToolResultPart | undefined;
    }
  | {
      readonly key: string;
      readonly kind: "memory";
      readonly update: MemoryUpdate;
    }
  | {
      readonly files: readonly FilePart[];
      readonly key: string;
      readonly kind: "files";
    }
  | {
      readonly key: string;
      readonly kind: "artifact";
      readonly part: ArtifactRefPart;
    }
  | {
      readonly key: string;
      readonly kind: "annotation";
      readonly part: AnnotationRefPart;
    }
  | { readonly key: string; readonly kind: "plan"; readonly plan: PlanRef }
  | {
      readonly approval: PlanApprovalRef;
      readonly key: string;
      readonly kind: "plan-approval";
    };

export interface MessageView {
  readonly blocks: readonly RenderBlock[];
  /** Citations, shown once under the message. */
  readonly sources: readonly SourcePart[];
}

/** Data parts the chat shows: memory notes, and plan mode's card and approvals (106). */
const dataBlock = (
  part: Extract<MessagePart, { type: "data" }>,
  key: string
): RenderBlock | null => {
  if (part.name === "memory-update") {
    const parsed = memoryUpdateSchema.safeParse(part.data);
    return parsed.success ? { key, kind: "memory", update: parsed.data } : null;
  }
  if (part.name === PLAN_DATA) {
    const parsed = planRefSchema.safeParse(part.data);
    return parsed.success ? { key, kind: "plan", plan: parsed.data } : null;
  }
  const approval = planApprovalOf(part.name, part.data);
  return approval ? { approval, key, kind: "plan-approval" } : null;
};

const blockFor = (
  part: MessagePart,
  key: string,
  results: ToolResultIndex
): RenderBlock | null => {
  switch (part.type) {
    case "text":
      return part.text.length > 0
        ? { key, kind: "text", text: part.text }
        : null;
    case "reasoning":
      return part.text.length > 0
        ? { key, kind: "reasoning", text: part.text }
        : null;
    case "tool-call": {
      const result = results.get(part.toolCallId);
      const memory =
        part.toolName === MEMORY_TOOL_NAME ? memoryFromResult(result) : null;
      return memory
        ? { key, kind: "memory", update: memory }
        : { call: part, key, kind: "tool", result };
    }
    case "artifact-ref":
      return { key, kind: "artifact", part };
    case "annotation-ref":
      return { key, kind: "annotation", part };
    case "data":
      return dataBlock(part, key);
    // Rendered elsewhere (files are grouped, sources listed once, results
    // joined to their calls) or not at all (step boundaries).
    case "file":
    case "source":
    case "tool-result":
    case "step-start":
      return null;
    default:
      return part satisfies never;
  }
};

/** A message's parts as render blocks: adjacent files grouped, sources collected. */
export const messageView = (
  parts: readonly MessagePart[],
  results: ToolResultIndex
): MessageView => {
  const blocks: RenderBlock[] = [];
  const sources: SourcePart[] = [];
  parts.forEach((part, index) => {
    // A tool call keeps its key when the message is rebuilt around it (a
    // resumed stream, the stored copy replacing the live one), so its card
    // stays mounted instead of coming back fresh (072).
    const key =
      part.type === "tool-call"
        ? `tool-call-${part.toolCallId}`
        : `${part.type}-${index}`;
    if (part.type === "source") {
      sources.push(part);
      return;
    }
    if (part.type === "file") {
      const last = blocks.at(-1);
      if (last?.kind === "files") {
        blocks[blocks.length - 1] = { ...last, files: [...last.files, part] };
      } else {
        blocks.push({ files: [part], key, kind: "files" });
      }
      return;
    }
    const block = blockFor(part, key, results);
    if (block) {
      blocks.push(block);
    }
  });
  return { blocks, sources };
};

/** The message's prose, for copy and edit. */
export const messageText = (message: Pick<Message, "parts">): string =>
  message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
