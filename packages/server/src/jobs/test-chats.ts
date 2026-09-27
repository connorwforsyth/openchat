import type { Db } from "@workspace/db/client";
import { deleteStaleTestChats } from "@workspace/db/queries/conversations";
import { ok } from "@workspace/shared/result";

import type { JobQueue } from "../ports/job-queue";
import { type JobHandlers, type Jobs, jobDefaults } from "./registry";

// Cleans up the Agent Builder's test chats (033). They never show in the
// history, and the builder drops them on "Start over" or when it closes,
// so nobody can find one again: after a day without a message it goes.

/** Hours a test chat is kept after its last message. */
export const TEST_CHAT_RETENTION_HOURS = 24;

/** Hourly, off the top of the hour. */
export const TEST_CHAT_PRUNE_CRON = "23 * * * *";

export interface TestChatJobDeps {
  readonly db: Db;
  readonly now?: () => Date;
  readonly retentionHours?: number;
}

export const testChatJobHandlers = ({
  db,
  now = () => new Date(),
  retentionHours = TEST_CHAT_RETENTION_HOURS,
}: TestChatJobDeps): JobHandlers => ({
  "testChat.prune": async () => {
    const before = new Date(now().getTime() - retentionHours * 3_600_000);
    return ok({ deleted: await deleteStaleTestChats(db, before) });
  },
});

/** Puts the cleanup on its schedule; call once at boot, after registering handlers. */
export const scheduleTestChatPrune = (queue: JobQueue<Jobs>) =>
  queue.schedule(
    "testChat.prune",
    TEST_CHAT_PRUNE_CRON,
    {},
    jobDefaults["testChat.prune"]
  );
