import type { AppConfig } from "@workspace/config/schema";
import type {
  SandboxLimits,
  SandboxProvider,
  sandboxIsolationSchema,
} from "@workspace/contract/schemas/sandbox";
import type { AsyncResult } from "@workspace/shared/result";
import { ok } from "@workspace/shared/result";
import type { z } from "zod";

import { createDockerSandboxFactory } from "./docker/client";
import { createJustBashFactory, defenseInDepthFor } from "./just-bash/provider";
import {
  createMemorySnapshotStore,
  type SnapshotStore,
} from "./just-bash/snapshot-store";
import type { SandboxError, SandboxFactory } from "./ports/sandbox";
import { createPreviewRestorer, type PreviewRestorer } from "./preview-restore";
import { createUnavailableFactory } from "./remote/stubs";
import { egressPolicyFor } from "./runner/egress";
import { consoleLog, type PreviewLog } from "./tools/static-preview";

// The instance's sandbox providers, built once at boot from app config. Only
// configured providers are present, so an empty config gives just-bash and
// nothing else; the handlers answer "not available" for the rest.

export type SandboxIsolation = z.infer<typeof sandboxIsolationSchema>;

export interface ProviderEntry {
  readonly factory: SandboxFactory;
  /** How strongly this provider isolates, for the record and the panel. */
  readonly isolation: () => AsyncResult<SandboxIsolation, SandboxError>;
  /** Limits new sandboxes get from this provider. */
  readonly limits: SandboxLimits;
  /**
   * Exposes a sandbox's recorded previews again, for a provider whose host
   * forgets them (the runner, on a restart). Absent: nothing to restore.
   */
  readonly restorePreviews?: PreviewRestorer;
}

export type SandboxProviders = ReadonlyMap<SandboxProvider, ProviderEntry>;

/** just-bash has no CPU or memory knobs; only the workspace size is enforced. */
const JUST_BASH_LIMITS: SandboxLimits = {
  cpu: 1,
  diskMb: 256,
  memoryMb: 256,
  network: false,
};

export interface ProvidersFromConfigOptions {
  /** Decides whether just-bash keeps its defense-in-depth layer (`defenseInDepthFor`). */
  readonly env?: { readonly NODE_ENV?: string };
  readonly fetch?: typeof fetch;
  /** Where best-effort preview failures are reported; defaults to the console. */
  readonly log?: PreviewLog;
  /** Where just-bash workspaces persist; defaults to process memory. */
  readonly store?: SnapshotStore;
}

export const sandboxProvidersFromConfig = (
  config: Pick<AppConfig, "features" | "sandbox">,
  {
    env = process.env,
    fetch,
    log,
    store = createMemorySnapshotStore(),
  }: ProvidersFromConfigOptions = {}
): SandboxProviders => {
  const providers = new Map<SandboxProvider, ProviderEntry>();
  if (!config.features.sandboxes || config.sandbox.default === "none") {
    return providers;
  }
  const defenseInDepth = defenseInDepthFor(env);
  if (!defenseInDepth) {
    (log ?? consoleLog)(
      "just-bash runs without its defense-in-depth layer under `next dev`: React's development async hooks trip it. Production keeps it."
    );
  }
  providers.set("just-bash", {
    factory: createJustBashFactory({ defenseInDepth, store }),
    isolation: () => Promise.resolve(ok("simulated" as const)),
    limits: JUST_BASH_LIMITS,
  });

  const { docker, e2b, egress, microsandbox, vercel } = config.sandbox;
  if (docker) {
    const factory = createDockerSandboxFactory({
      egress: egressPolicyFor(egress),
      fetch,
      runnerUrl: docker.runnerUrl,
      token: docker.token,
    });
    providers.set("docker", {
      factory,
      isolation: async () => {
        const status = await factory.runnerStatus();
        return status.ok ? ok(status.value.isolation) : status;
      },
      limits: {
        cpu: docker.limits.cpu,
        diskMb: docker.limits.diskMb,
        memoryMb: docker.limits.memoryMb,
        network: egress.mode !== "none",
      },
      restorePreviews: createPreviewRestorer({ log }),
    });
  }
  const remote = [
    ["e2b", e2b?.apiKey],
    ["vercel", vercel?.token],
    ["microsandbox", microsandbox],
  ] as const;
  for (const [provider, configured] of remote) {
    if (configured) {
      providers.set(provider, {
        factory: createUnavailableFactory(provider),
        isolation: () => Promise.resolve(ok("vm" as const)),
        limits: JUST_BASH_LIMITS,
      });
    }
  }
  return providers;
};
