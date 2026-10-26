import type { MessageId } from "@workspace/contract/schemas/common";
import {
  messageIdSchema,
  timestampSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import {
  type MessagePart,
  messagePartSchema,
} from "@workspace/contract/schemas/message-parts";
import { z } from "zod";

// A steer (a turn sent with `delivery: "steer"`) that a running answer took
// at a step boundary. The tree gets it as it happened: the answer so far,
// then the steer's own user message, then a new answer under it that the
// same run goes on writing. The run's stream carries a `data-steer` marker
// at that point, so a page following the stream can show the same split
// before the stored branch has it, and the server splits the streamed
// answer at the markers when it stores it. A marker is never stored.

/** The data part name: `data-steer` in AI SDK terms. */
export const STEER_DATA = "steer";

export const steerDataSchema = z.object({
  /** The answer the run writes from here on, under the steer. */
  answerId: messageIdSchema,
  /** The steer's user message, as stored. */
  message: z.object({
    authorId: userIdSchema.nullable(),
    createdAt: timestampSchema,
    id: messageIdSchema,
    parts: z.array(messagePartSchema),
  }),
  /** The answer the steer came after. */
  previousAnswerId: messageIdSchema,
});
export type SteerData = z.infer<typeof steerDataSchema>;

/** One stored answer's share of a streamed answer that took steers. */
export interface AnswerSegment {
  readonly answerId: MessageId;
  readonly parts: readonly MessagePart[];
  /** The steer this segment answers; absent on the first. */
  readonly steer?: SteerData;
}

/** A part's steer marker, when it is one. Pure. */
export const steerOf = (part: MessagePart): SteerData | undefined => {
  if (part.type !== "data" || part.name !== STEER_DATA) {
    return;
  }
  const parsed = steerDataSchema.safeParse(part.data);
  return parsed.success ? parsed.data : undefined;
};

/**
 * An answer's parts cut at each steer marker: what came before the first
 * marker belongs to `firstAnswerId`, what follows each marker to the
 * answer it names. Markers themselves are dropped. Pure.
 */
export const splitAtSteers = (
  firstAnswerId: MessageId,
  parts: readonly MessagePart[]
): readonly AnswerSegment[] => {
  const segments: {
    answerId: MessageId;
    parts: MessagePart[];
    steer?: SteerData;
  }[] = [{ answerId: firstAnswerId, parts: [] }];
  for (const part of parts) {
    const steer = steerOf(part);
    if (steer) {
      segments.push({ answerId: steer.answerId, parts: [], steer });
    } else {
      segments.at(-1)?.parts.push(part);
    }
  }
  return segments;
};
