import { loadConfig } from "@workspace/config/load";
import { formatConfigErrors } from "@workspace/config/parse";
import { createServerFromEnv, type Server } from "@workspace/server/server";

import { bindSandbox } from "./sandbox";

// One server per process (D4: runs, streams and jobs live in `web` for M1).
// It boots on the first request, not at import, so `next build` never opens
// a database. The promise is kept on `globalThis` because dev-mode reloads
// re-evaluate this module, and a second boot would open the embedded
// database's directory twice. Pages that need the session or the database
// (039) take them from here too, for the same reason.

export type Boot =
  | { readonly ok: true; readonly server: Server }
  | { readonly message: string; readonly ok: false };

const BOOT = Symbol.for("@workspace/server/boot");

type Holder = typeof globalThis & { [BOOT]?: Promise<Boot> };

const causeOf = (cause: unknown): string =>
  cause instanceof Error ? `: ${cause.message}` : "";

const boot = async (): Promise<Boot> => {
  const loaded = await loadConfig();
  if (!loaded.ok) {
    // D18: an invalid app.config.yaml fails with a readable error, here on
    // every API request and in the server log, instead of half-starting.
    const message = formatConfigErrors(loaded.error);
    console.error(`[config] app.config.yaml is invalid:\n${message}`);
    return { message, ok: false };
  }
  const server = await createServerFromEnv({
    config: loaded.value.config,
    log: (message) => console.info(message),
    // Messages are written never to hold secrets; causes are cut to their
    // message for the same reason (a driver error can echo its input).
    report: (message, cause) =>
      console.error(`[server] ${message}${causeOf(cause)}`),
    sandbox: bindSandbox,
  });
  process.once("SIGTERM", () => {
    server.stop().catch(() => undefined);
  });
  return { ok: true, server };
};

export const getServer = (): Promise<Boot> => {
  const holder = globalThis as Holder;
  holder[BOOT] ??= boot();
  return holder[BOOT];
};
