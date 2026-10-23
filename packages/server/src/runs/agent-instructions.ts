import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { userSummaries } from "@workspace/db/queries/library-items";
import { fillAgentVariables } from "@workspace/shared/agent-variables";

/**
 * An agent's instructions with today's date (UTC) and the name of the person
 * it answers filled in: what a chat turn and an eval case both send.
 */
export const fillAgentInstructions = async (
  db: Db,
  userId: UserId,
  instructions: string,
  now: () => Date = () => new Date()
): Promise<string> =>
  fillAgentVariables(instructions, {
    current_date: now().toLocaleDateString("en", {
      dateStyle: "full",
      timeZone: "UTC",
    }),
    current_user: (await userSummaries(db, [userId]))[0]?.name || "the user",
  });
