import { readFile, writeFile } from "node:fs/promises";

import type { BrowserContext, Page } from "@playwright/test";
import { type ApiClient, createApiClient } from "@workspace/client/api";
import { orgIdSchema, teamIdSchema } from "@workspace/contract/schemas/common";
import { z } from "zod";

// The typed API client (the one the app uses) acting as a signed-in browser:
// it carries that browser's session cookie. The suite sets up what has no UI
// yet through it (an org), and reads back what the UI only implies (who paid,
// what the memory file says), so the checks are about the server's state
// rather than about wording.

export const apiFor = async (
  from: BrowserContext | Page,
  baseURL: string
): Promise<ApiClient> => {
  const context = "context" in from ? from.context() : from;
  const cookies = await context.cookies(baseURL);
  const cookie = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  return createApiClient({
    baseUrl: baseURL,
    batch: false,
    fetch: globalThis.fetch,
    headers: () => ({ cookie, origin: baseURL }),
  });
};

/** What accounts.setup.ts created, for the specs that build on it. */
export const worldSchema = z.object({
  eng: teamIdSchema,
  orgId: orgIdSchema,
  platform: teamIdSchema,
});
export type World = z.infer<typeof worldSchema>;

const worldFile = new URL("../.auth/world.json", import.meta.url);

export const saveWorld = (world: World) =>
  writeFile(worldFile, JSON.stringify(world, null, 2));

export const loadWorld = async (): Promise<World> =>
  worldSchema.parse(JSON.parse(await readFile(worldFile, "utf8")));

/** Polls `read` until `done` holds, for background work (titles, indexing). */
export const eventually = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { intervalMs = 250, timeoutMs = 20_000 } = {}
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!done(last)) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs} ms; last value: ${JSON.stringify(last)}`
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: polling is sequential by nature.
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
    last = await read();
  }
  return last;
};
