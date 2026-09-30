import type { JsonValue } from "@workspace/contract/schemas/common";
import type {
  ModelParameters,
  TokenUsage,
} from "@workspace/contract/schemas/models";
import type { RunError } from "@workspace/contract/schemas/runs";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import {
  convertToModelMessages,
  getToolOrDynamicToolName,
  isStepCount,
  isToolUIPart,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolApprovalStatus,
  ToolLoopAgent,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import { toRunError } from "../errors/run-error";
import { ARTIFACT_REF_DATA } from "../messages/to-ui";
import {
  type ArtifactRef,
  artifactRefOf,
  isArtifactTool,
} from "../tools/artifacts";
import { callSettings } from "./call-settings";

// The agent runner (D2, PLAN.md §8 step 3.5): one turn of a `ToolLoopAgent`
// over the conversation so far, streamed as AI SDK UI message chunks. The run
// executor (ticket 014) writes the chunks to the run's StreamChannel, and when
// the stream ends reads `outcome` to settle the run and persist the answer.
//
// Tool approvals: tools marked `user-approval` stop the loop at their call.
// The outcome is then `awaiting_approval`, listing the calls. To resume, the
// executor rebuilds the history with the decisions on the calls (`toUIMessages`
// maps `decided` to `approval-responded`) and runs again; the SDK executes
// approved calls, reports denied ones to the model, and continues the same
// assistant message.
//
// Artifacts: a tool can't write parts into the stream, so when an artifact
// tool's result arrives, its `data-artifact-ref` part is added here, right
// after the call, both to the stream (the card shows while the answer is
// still streaming) and to the outcome's message (the card is stored).

export interface RunAgentInput {
  /** Tools whose names are listed here only; the rest stay defined but uncallable. */
  readonly activeTools?: readonly string[];
  /** For the answer message; the executor usually passes the id it will store. */
  readonly generateMessageId?: () => string;
  readonly instructions?: string;
  /** Hard stop for a runaway loop. */
  readonly maxSteps?: number;
  /** The branch so far, oldest first, ending with the user's message (or the assistant message being resumed). */
  readonly messages: readonly UIMessage[];
  readonly model: LanguageModel;
  readonly parameters?: ModelParameters;
  readonly signal?: AbortSignal;
  /** Wall clock for the whole turn (app.config.yaml `limits.runTimeoutSeconds`). */
  readonly timeoutMs?: number;
  readonly toolApproval?: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools?: ToolSet;
}

export interface AwaitedCall {
  readonly input: JsonValue;
  readonly toolCallId: string;
  readonly toolName: string;
}

interface OutcomeBase {
  /** The assistant message as streamed; map it with `fromUIMessage` to store it. */
  readonly message: UIMessage;
  readonly usage: TokenUsage;
}

export type AgentOutcome =
  | (OutcomeBase & { readonly status: "succeeded" })
  | (OutcomeBase & {
      readonly approvals: readonly AwaitedCall[];
      readonly status: "awaiting_approval";
    })
  | (OutcomeBase & { readonly error: RunError; readonly status: "failed" })
  | (OutcomeBase & { readonly status: "cancelled" });

export interface AgentRun {
  /** Resolves once `stream` has been read to its end (or cancelled). Never rejects. */
  readonly outcome: Promise<AgentOutcome>;
  readonly stream: ReadableStream<UIMessageChunk>;
}

const DEFAULT_MAX_STEPS = 20;

const addUsage = (total: TokenUsage, step: LanguageModelUsage): TokenUsage => ({
  cachedInputTokens:
    (total.cachedInputTokens ?? 0) +
    (step.inputTokenDetails.cacheReadTokens ?? 0),
  inputTokens: total.inputTokens + (step.inputTokens ?? 0),
  outputTokens: total.outputTokens + (step.outputTokens ?? 0),
  reasoningTokens:
    (total.reasoningTokens ?? 0) +
    (step.outputTokenDetails.reasoningTokens ?? 0),
});

/** Calls in the answer still waiting on a person. */
export const awaitedCalls = (message: UIMessage): readonly AwaitedCall[] =>
  message.parts.flatMap((part) =>
    isToolUIPart(part) &&
    part.state === "approval-requested" &&
    !part.approval.isAutomatic
      ? [
          {
            input: part.input as JsonValue,
            toolCallId: part.toolCallId,
            toolName:
              part.type === "dynamic-tool" ? part.toolName : part.type.slice(5),
          },
        ]
      : []
  );

type UIPart = UIMessage["parts"][number];

const artifactPart = (ref: ArtifactRef) => ({
  data: ref,
  // One card per version: a replayed chunk replaces it instead of adding another.
  id: ref.versionId,
  type: `data-${ARTIFACT_REF_DATA}` as const,
});

const toolNameOf = (part: UIPart): string | undefined =>
  isToolUIPart(part) ? getToolOrDynamicToolName(part) : undefined;

const shownVersions = (parts: readonly UIPart[]): Set<unknown> =>
  new Set(
    parts.flatMap((part) =>
      part.type === `data-${ARTIFACT_REF_DATA}`
        ? [(part as { data?: { versionId?: unknown } }).data?.versionId]
        : []
    )
  );

/**
 * The answer with an `artifact-ref` after each artifact tool call that
 * saved one. A resumed answer already carries the earlier ones, so a
 * version that has its card isn't given another. Pure.
 */
export const withArtifactRefs = (message: UIMessage): UIMessage => {
  const shown = shownVersions(message.parts);
  const parts = message.parts.flatMap((part): UIPart[] => {
    const name = toolNameOf(part);
    if (
      !(name && isArtifactTool(name) && isToolUIPart(part)) ||
      part.state !== "output-available"
    ) {
      return [part];
    }
    const ref = artifactRefOf(part.output);
    if (!ref || shown.has(ref.versionId)) {
      return [part];
    }
    shown.add(ref.versionId);
    return [part, artifactPart(ref) as UIPart];
  });
  return parts.length === message.parts.length
    ? message
    : { ...message, parts };
};

/**
 * Follows the chunks with each saved artifact's `data-artifact-ref`. A
 * result chunk names only its call, so tool names come from the calls seen
 * so far: the ones in `messages` (a resumed pass executes calls an earlier
 * pass streamed) and the ones this stream starts.
 */
const artifactRefsInStream = (
  messages: readonly UIMessage[]
): TransformStream<UIMessageChunk, UIMessageChunk> => {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      const name = toolNameOf(part);
      if (name && isToolUIPart(part)) {
        names.set(part.toolCallId, name);
      }
    }
  }
  return new TransformStream({
    transform: (chunk, controller) => {
      controller.enqueue(chunk);
      if (
        chunk.type === "tool-input-start" ||
        chunk.type === "tool-input-available"
      ) {
        names.set(chunk.toolCallId, chunk.toolName);
        return;
      }
      if (
        chunk.type !== "tool-output-available" ||
        !isArtifactTool(names.get(chunk.toolCallId) ?? "")
      ) {
        return;
      }
      const ref = artifactRefOf(chunk.output);
      if (ref) {
        controller.enqueue(artifactPart(ref) as UIMessageChunk);
      }
    },
  });
};

export const runAgent = async (
  input: RunAgentInput
): AsyncResult<AgentRun, RunError> => {
  const messages = [...input.messages];
  let modelMessages: ModelMessage[];
  try {
    modelMessages = await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools: input.tools,
    });
  } catch {
    return err({
      code: "internal",
      message: "The conversation couldn't be prepared for the model.",
      retryable: false,
    });
  }

  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let failure: RunError | undefined;
  let settle: (outcome: AgentOutcome) => void = () => undefined;
  const outcome = new Promise<AgentOutcome>((resolve) => {
    settle = resolve;
  });

  const agent = new ToolLoopAgent({
    ...callSettings(input.parameters ?? {}),
    activeTools: input.activeTools ? [...input.activeTools] : undefined,
    instructions: input.instructions,
    model: input.model,
    stopWhen: isStepCount(input.maxSteps ?? DEFAULT_MAX_STEPS),
    toolApproval: input.toolApproval,
    tools: input.tools,
  });

  let result: Awaited<ReturnType<typeof agent.stream>>;
  try {
    result = await agent.stream({
      abortSignal: input.signal,
      messages: modelMessages,
      onStepEnd: (step) => {
        usage = addUsage(usage, step.usage);
      },
      timeout: input.timeoutMs ? { totalMs: input.timeoutMs } : undefined,
    });
  } catch (cause) {
    return err(toRunError(cause));
  }

  const stream = result.toUIMessageStream({
    generateMessageId: input.generateMessageId,
    onEnd: ({ isAborted, responseMessage }) => {
      const base = { message: withArtifactRefs(responseMessage), usage };
      if (failure) {
        settle({ ...base, error: failure, status: "failed" });
      } else if (isAborted || input.signal?.aborted) {
        settle({ ...base, status: "cancelled" });
      } else {
        const approvals = awaitedCalls(responseMessage);
        settle(
          approvals.length > 0
            ? { ...base, approvals, status: "awaiting_approval" }
            : { ...base, status: "succeeded" }
        );
      }
    },
    // The chunk the client sees; the full error goes to traces, not the stream.
    onError: (error) => {
      failure ??= toRunError(error);
      return failure.message;
    },
    originalMessages: messages,
    sendReasoning: true,
    sendSources: true,
  });

  return ok({
    outcome,
    stream: stream.pipeThrough(artifactRefsInStream(messages)),
  });
};
