import { z } from "zod";

import {
  feedbackIdSchema,
  messageIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";

// Thumbs feedback on assistant messages (D21, M1 production quality).
// Maintainers of the agent see aggregates; content only if the user opts in.

export const feedbackRatingSchema = z.enum(["up", "down"]);

export const feedbackSchema = z.object({
  comment: z.string().max(4000).nullable(),
  createdAt: timestampSchema,
  id: feedbackIdSchema,
  messageId: messageIdSchema,
  rating: feedbackRatingSchema,
  /** "Share this conversation with the agent's maintainers". */
  shareWithMaintainers: z.boolean(),
  updatedAt: timestampSchema,
  userId: userIdSchema,
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** One feedback per user per message: setting it again replaces it. */
export const setFeedbackInputSchema = z.object({
  comment: z.string().trim().max(4000).optional(),
  messageId: messageIdSchema,
  rating: feedbackRatingSchema,
  shareWithMaintainers: z.boolean().default(false),
});
