import type { Dot } from "@workspace/contract/schemas/dots";

import { routes } from "@/lib/routes";

/** How long ⌘. waits for a cold Dot list before it settles for /dots. */
export const DOT_WAIT_MS = 2000;

export interface DotRouteDeps {
  readonly listDots: () => Promise<readonly Pick<Dot, "conversationId">[]>;
  /** Where the user is now, read before and after the wait. */
  readonly location: () => string;
  readonly waitMs: number;
}

/**
 * Where ⌘. goes (174): your Dot's thread, or /dots without one. On a cold
 * load the list may still be in flight, so it waits, but only `waitMs`; a
 * slow or failed list means /dots. `null` when the user moved on while it
 * waited, so a late answer doesn't yank them back.
 */
export const dotRoute = async ({
  listDots,
  location,
  waitMs,
}: DotRouteDeps): Promise<string | null> => {
  const from = location();
  let timer: number | undefined;
  const mine = await Promise.race([
    listDots().then(
      ([first]) => first,
      () => undefined
    ),
    new Promise<undefined>((resolve) => {
      timer = window.setTimeout(resolve, waitMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
  if (location() !== from) {
    return null;
  }
  return mine ? routes.chat(mine.conversationId) : routes.dots;
};
