import type { DotActivity } from "@workspace/contract/schemas/dots";

/** Runs that finished after `since` (all of them before the first visit). */
export const unseenRuns = (
  activity: readonly DotActivity[],
  since: string | null
): DotActivity[] =>
  activity.filter(
    (item) =>
      item.finishedAt !== null && (since === null || item.finishedAt > since)
  );
