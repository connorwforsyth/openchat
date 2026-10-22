import {
  type ConversationId,
  conversationIdSchema,
  orgIdSchema,
  teamIdSchema,
  type UserId,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { z } from "zod";

// Who a model call is for, put on every span it makes so a trace viewer can
// total tokens and cost per person, chat and space. Langfuse reads
// `langfuse.user.id` and `session.id`; other viewers see plain attributes.
// It travels as the call's runtime context, under `TRACE_CONTEXT_KEY`.

export const traceContextSchema = z.object({
  conversationId: conversationIdSchema.optional(),
  /** The team or org the chat is in; absent for Personal. */
  spaceId: z.union([orgIdSchema, teamIdSchema]).optional(),
  userId: userIdSchema,
});
export type TraceContext = z.infer<typeof traceContextSchema>;

export const TRACE_CONTEXT_KEY = "trace";

/** A chat's trace context: its owner's call, in its space. */
export const chatTrace = (input: {
  readonly context: ChatContext;
  readonly conversationId: ConversationId;
  readonly userId: UserId;
}): TraceContext => ({
  conversationId: input.conversationId,
  ...(input.context.type === "personal" ? {} : { spaceId: input.context.id }),
  userId: input.userId,
});

/** The runtime context and telemetry options that put `trace` on a call's spans. */
export const tracedCall = (trace: TraceContext | undefined) => ({
  runtimeContext: { [TRACE_CONTEXT_KEY]: trace },
  telemetry: { includeRuntimeContext: { [TRACE_CONTEXT_KEY]: true } },
});

export const traceAttributes = (
  trace: TraceContext
): Record<string, string> => ({
  "langfuse.user.id": trace.userId,
  ...(trace.conversationId ? { "session.id": trace.conversationId } : {}),
  ...(trace.spaceId
    ? { "langfuse.trace.metadata.space_id": trace.spaceId }
    : {}),
});

/** The span attributes for a call's runtime context, if it names who the call is for. */
export const traceAttributesOf = (
  runtimeContext: Record<string, unknown> | undefined
): Record<string, string> | undefined => {
  const parsed = traceContextSchema.safeParse(
    runtimeContext?.[TRACE_CONTEXT_KEY]
  );
  return parsed.success ? traceAttributes(parsed.data) : undefined;
};

/** `observability.userTracesUrl` as a link maker; `undefined` when it isn't set. */
export const userTracesUrlOf = (
  template: string | null
): ((userId: UserId) => string) | undefined =>
  template === null
    ? undefined
    : (userId) => template.replaceAll("{userId}", encodeURIComponent(userId));
