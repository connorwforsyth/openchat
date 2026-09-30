import {
  approvalReason,
  type InterruptedBy,
  interruptedMessage,
  isApproved,
} from "@workspace/ai/messages/approval";
import type { JsonValue, UserId } from "@workspace/contract/schemas/common";
import type {
  ApprovalDecision,
  MessagePart,
} from "@workspace/contract/schemas/message-parts";
import type { ToolApproval } from "@workspace/contract/schemas/runs";
import type { UIMessageChunk } from "ai";

// What a run's stream and answer say when a person decides or stops it
// (072). The stream is what every open client renders, so a decision or a
// stop is announced there at once, as ordinary AI SDK chunks, rather than
// left for each client to notice on its next refetch. Pure.

/** A value with its object keys sorted, so equal decisions compare equal. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, each]) => each !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, each]) => [key, canonical(each)])
    );
  }
  return value;
};

/**
 * Whether two decisions are the same call. Stored ones come back from
 * `jsonb` with their keys reordered, so they're compared by content.
 */
export const sameDecision = (a: ApprovalDecision, b: ApprovalDecision) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * The chunks that tell clients a call was decided. The AI SDK streams no
 * response when a paused pass resumes: without these a client keeps the
 * card until the tool's output lands, and a second tab never learns that
 * someone else decided.
 */
export const decisionChunks = (
  decisions: readonly ToolApproval[],
  /**
   * The id each call was asked under in this stream (the SDK makes its own;
   * a client finds the call by it). A call without one isn't announced: a
   * response the client can't place would fail its whole stream.
   */
  approvalIds: ReadonlyMap<string, string>
): UIMessageChunk[] =>
  decisions.flatMap(({ decision, toolCallId }) => {
    const approvalId = approvalIds.get(toolCallId);
    if (!approvalId) {
      return [];
    }
    const reason = approvalReason(decision);
    return [
      {
        approvalId,
        approved: isApproved(decision),
        ...(reason ? { reason } : {}),
        type: "tool-approval-response",
      },
    ];
  });

/**
 * The decisions not yet recorded, deduplicated by call. A call already
 * decided keeps its decision: the same one again is dropped (a retry, a
 * second tab), a different one makes the whole set `null`, refused.
 */
export const newDecisions = (
  recorded: ReadonlyMap<string, { readonly decision: ApprovalDecision }>,
  decisions: readonly ToolApproval[]
): ToolApproval[] | null => {
  const byCall = new Map(decisions.map((d) => [d.toolCallId, d]));
  const fresh: ToolApproval[] = [];
  for (const each of byCall.values()) {
    const prior = recorded.get(each.toolCallId);
    if (!prior) {
      fresh.push(each);
    } else if (!sameDecision(prior.decision, each.decision)) {
      return null;
    }
  }
  return fresh;
};

/** The answer's parts with `decisions` recorded on their calls. */
export const withDecisions = (
  parts: readonly MessagePart[],
  decisions: readonly ToolApproval[],
  { by, decidedAt }: { readonly by: UserId; readonly decidedAt: string }
): MessagePart[] => {
  const byCall = new Map(decisions.map((d) => [d.toolCallId, d.decision]));
  return parts.map((part): MessagePart => {
    const decision =
      part.type === "tool-call" ? byCall.get(part.toolCallId) : undefined;
    return part.type === "tool-call" && decision
      ? {
          ...part,
          approval: { decidedAt, decidedBy: by, decision, state: "decided" },
        }
      : part;
  });
};

const OUTPUT_TAIL_LINES = 20;
const OUTPUT_TAIL_CHARS = 4000;

const tail = (text: string): string =>
  text
    .split("\n")
    .slice(-OUTPUT_TAIL_LINES)
    .join("\n")
    .slice(-OUTPUT_TAIL_CHARS);

/**
 * What a stopped command had printed, from its tool's output: the `bash`
 * tool (and anything shaped like it) reports `stdout` and `stderr`.
 */
export const partialOutputOf = (output: unknown): string | undefined => {
  if (typeof output !== "object" || output === null) {
    return;
  }
  const streams = ["stdout", "stderr"].flatMap((key) => {
    const text = (output as Record<string, unknown>)[key];
    return typeof text === "string" && text.trim() !== ""
      ? [text.trimEnd()]
      : [];
  });
  return streams.length > 0 ? tail(streams.join("\n")) : undefined;
};

export interface Interrupted {
  /** `tool-output-error` for each stopped call, for the run's stream. */
  readonly chunks: UIMessageChunk[];
  readonly parts: MessagePart[];
  readonly toolCallIds: readonly string[];
}

/** Whether a call had started running (or would have, unasked). */
const started = (part: Extract<MessagePart, { type: "tool-call" }>) => {
  switch (part.approval.state) {
    case "not-required":
      return true;
    case "pending":
      return false;
    case "decided":
      return isApproved(part.approval.decision);
    default:
      return part.approval satisfies never;
  }
};

/**
 * The answer of a stopped run, with every tool call that has no result yet
 * given a stopped one right after it (opencode's `interrupted`). A running
 * command keeps what it had printed (`partial`). Only calls in `streamed`
 * get a chunk: a client that never saw a call would fail on its output.
 */
export const interruptLeftovers = (
  parts: readonly MessagePart[],
  {
    by,
    partial = new Map(),
    streamed,
  }: {
    readonly by: InterruptedBy;
    readonly partial?: ReadonlyMap<string, string>;
    readonly streamed: ReadonlySet<string>;
  }
): Interrupted => {
  const answered = new Set(
    parts.flatMap((part) =>
      part.type === "tool-result" ? [part.toolCallId] : []
    )
  );
  const chunks: UIMessageChunk[] = [];
  const toolCallIds: string[] = [];
  const next = parts.flatMap((part): MessagePart[] => {
    if (
      part.type !== "tool-call" ||
      part.providerExecuted ||
      answered.has(part.toolCallId)
    ) {
      return [part];
    }
    const ran = started(part);
    const message = interruptedMessage(
      by,
      ran,
      ran ? partial.get(part.toolCallId) : undefined
    );
    toolCallIds.push(part.toolCallId);
    if (streamed.has(part.toolCallId)) {
      chunks.push({
        errorText: message,
        toolCallId: part.toolCallId,
        type: "tool-output-error",
      });
    }
    return [
      part,
      {
        output: { message, status: "error" },
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        type: "tool-result",
      },
    ];
  });
  return { chunks, parts: next, toolCallIds };
};

/** Tool calls a stream has shown clients, by id. */
export const streamedCalls = (chunks: readonly UIMessageChunk[]): Set<string> =>
  new Set(
    chunks.flatMap((chunk) =>
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error" ||
      chunk.type === "tool-approval-request"
        ? [chunk.toolCallId]
        : []
    )
  );

/** JSON for the stream writer. */
export const chunkJson = (chunk: UIMessageChunk): JsonValue =>
  JSON.parse(JSON.stringify(chunk)) as JsonValue;
