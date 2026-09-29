import type { SandboxId } from "@workspace/contract/schemas/common";
import type { sandboxPreviewSchema } from "@workspace/contract/schemas/sandbox";
import type { z } from "zod";

import type { Sandbox } from "./ports/sandbox";
import {
  consoleLog,
  ensureStaticPreview,
  type PreviewLog,
  STATIC_PREVIEW_PORT,
  type StaticPreviewSandbox,
} from "./tools/static-preview";

// The runner keeps the ports a sandbox exposed in memory, so after it
// restarts every preview on the chat's row answers 404 until something
// exposes the port again. The row is what survives, so when a workspace is
// attached for use, or read while running, its recorded ports (the static
// preview's among them) are exposed again. Exposing is idempotent in the
// runner, but it also counts as activity there (and starts a stopped
// container), so it's done at most once per sandbox per `everyMs` in this
// process: a restart is noticed within that, and a panel that keeps
// reading doesn't keep the sandbox from idling out.
//
// The static preview's port is ours to bring back whole: its server died
// with the container if the sandbox was stopped, so it's started again
// rather than only exposed. The agent's own servers aren't restarted.

type SandboxPreview = z.infer<typeof sandboxPreviewSchema>;

export type RestorableSandbox = StaticPreviewSandbox & Pick<Sandbox, "id">;

/** Exposes a sandbox's recorded previews again; returns what it exposed. */
export type PreviewRestorer = (
  sandbox: RestorableSandbox,
  previews: readonly SandboxPreview[]
) => Promise<readonly SandboxPreview[]>;

export const RESTORE_EVERY_MS = 60_000;

export interface PreviewRestorerOptions {
  readonly everyMs?: number;
  readonly log?: PreviewLog;
  readonly now?: () => number;
  /** Waits between the static server's listener probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const createPreviewRestorer = ({
  everyMs = RESTORE_EVERY_MS,
  log = consoleLog,
  now = Date.now,
  sleep,
}: PreviewRestorerOptions = {}): PreviewRestorer => {
  const restoreOne = async (
    sandbox: RestorableSandbox,
    port: number
  ): Promise<readonly SandboxPreview[]> => {
    if (port === STATIC_PREVIEW_PORT) {
      const preview = await ensureStaticPreview(sandbox, { sleep });
      if (!preview.ok) {
        log(
          `[sandbox] couldn't bring back the static preview of ${sandbox.id}: ${preview.error}`
        );
      }
      return preview.ok && preview.value ? [preview.value] : [];
    }
    const exposed = await sandbox.exposePort(port);
    if (!exposed.ok) {
      log(
        `[sandbox] couldn't expose port ${port} of ${sandbox.id} again: ${exposed.error.type}`
      );
    }
    return exposed.ok ? [exposed.value] : [];
  };
  const restoredAt = new Map<SandboxId, number>();
  return async (sandbox, previews) => {
    const at = now();
    // Forget the old entries as it goes, so the map holds only recent ones.
    for (const [id, when] of restoredAt) {
      if (at - when >= everyMs) {
        restoredAt.delete(id);
      }
    }
    if (previews.length === 0 || restoredAt.has(sandbox.id)) {
      return [];
    }
    restoredAt.set(sandbox.id, at);
    const exposed = await Promise.all(
      previews.map(({ port }) => restoreOne(sandbox, port))
    );
    return exposed.flat();
  };
};
