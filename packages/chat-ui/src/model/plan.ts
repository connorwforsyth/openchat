import {
  type ArtifactId,
  artifactIdSchema,
  artifactVersionIdSchema,
  type JsonValue,
} from "@workspace/contract/schemas/common";
import type { UserMessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { UIMessage } from "ai";
import { z } from "zod";

// Plan mode in the chat (106). A planning run's answer ends with a `plan`
// data part naming the "Plan: …" artifact the server saved it as; the chat
// shows it as the plan card. Approving sends a `plan-approval` data part
// with the next message (and the edited text, if the person edited it),
// which the server pins to the version approved. The server owns both
// shapes (`server/src/runs/plan-mode.ts`); these read them.

export const PLAN_DATA = "plan";
export const PLAN_APPROVAL_DATA = "plan-approval";

export const planRefSchema = z.object({
  artifactId: artifactIdSchema,
  title: z.string(),
  versionId: artifactVersionIdSchema,
});
export type PlanRef = z.infer<typeof planRefSchema>;

const approvalSchema = z.looseObject({
  artifactId: artifactIdSchema,
  versionId: artifactVersionIdSchema.optional(),
});
export type PlanApprovalRef = z.infer<typeof approvalSchema>;

/** A data part's plan approval, if it is one. Pure. */
export const planApprovalOf = (
  name: string,
  data: unknown
): PlanApprovalRef | null => {
  if (name !== PLAN_APPROVAL_DATA) {
    return null;
  }
  const parsed = approvalSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
};

/** Plans a message on the branch has approved, by artifact. Pure. */
export const approvedPlanIds = (
  messages: readonly Pick<Message, "parts" | "role">[]
): ReadonlySet<ArtifactId> =>
  new Set(
    messages.flatMap((message) =>
      message.role === "user"
        ? message.parts.flatMap((part) => {
            const approval =
              part.type === "data"
                ? planApprovalOf(part.name, part.data)
                : null;
            return approval ? [approval.artifactId] : [];
          })
        : []
    )
  );

/**
 * The message `useChat` sends to approve a plan: its text, then the
 * approval, with the edited plan when the person changed it. Pure.
 */
export const planApprovalMessage = (
  text: string,
  plan: Pick<PlanRef, "artifactId">,
  content?: string
) => ({
  parts: [
    { text, type: "text" as const },
    {
      data: {
        artifactId: plan.artifactId,
        ...(content === undefined ? {} : { content }),
      },
      type: `data-${PLAN_APPROVAL_DATA}` as const,
    },
  ],
});

/**
 * A sent message's plan approval as a stored part, for the run transport,
 * whose default keeps only text, files and mentions. Pure.
 */
export const planApprovalParts = (message: UIMessage): UserMessagePart[] =>
  message.parts.flatMap((part): UserMessagePart[] => {
    if (part.type !== `data-${PLAN_APPROVAL_DATA}`) {
      return [];
    }
    const { data } = part as { readonly data?: unknown };
    return approvalSchema.safeParse(data).success
      ? [
          {
            data: data as JsonValue,
            name: PLAN_APPROVAL_DATA,
            type: "data",
          },
        ]
      : [];
  });
