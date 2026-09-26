import type { SandboxId } from "@workspace/contract/schemas/common";
import type {
  SandboxLimits,
  sandboxIsolationSchema,
} from "@workspace/contract/schemas/sandbox";
import { WORKDIR } from "@workspace/sandbox/paths";
import type { RunnerRuntime } from "@workspace/sandbox/runner/protocol";
import { err, ok, type Result } from "@workspace/shared/result";
import type { ContainerCreateOptions } from "dockerode";
import type { z } from "zod";

// What every sandbox container looks like, as pure functions over config
// (D7, docs/decisions/0005). The hardening is applied whatever the runtime,
// so gVisor is defence in depth rather than the only wall:
// - no host mounts: the workdir is a named volume, /tmp and $HOME are
//   size-capped tmpfs, the root filesystem is read-only;
// - every capability dropped, no-new-privileges, the default seccomp
//   profile, a non-root user and no privileged mode;
// - CPU, memory (no swap), pids and (where the storage driver can) disk caps;
// - a network of its own that is `internal` (no route out) unless the
//   egress policy says otherwise.

export type Isolation = z.infer<typeof sandboxIsolationSchema>;

/** Labels the runner puts on everything it creates, to find it again. */
export const MANAGED_LABEL = "sandbox-runner.managed";
export const SANDBOX_LABEL = "sandbox-runner.sandbox";

export const containerName = (id: SandboxId) => `sbx-${id}`;
export const volumeName = (id: SandboxId) => `sbx-${id}`;
export const networkName = (id: SandboxId) => `sbx-${id}`;
/** The shared, non-internal network sandboxes join only under `open` egress. */
export const EGRESS_NETWORK = "sandbox-egress";

/** Where $HOME lives: tmpfs, so tool caches never land in the workspace. */
export const SANDBOX_HOME = "/home/sandbox";

export type EgressPolicy =
  | { readonly mode: "none" }
  | { readonly mode: "open" }
  /** Traffic may leave only through this proxy, which enforces the allowlist. */
  | { readonly mode: "allowlist"; readonly proxyUrl: string };

export type RuntimeRequest = "auto" | RunnerRuntime;

export interface RuntimeChoice {
  readonly isolation: Isolation;
  readonly runtime: RunnerRuntime;
  /** For the admin UI when isolation is plain containers. */
  readonly warning: string | null;
}

const RUNC_WARNING =
  "Sandboxes run under plain Docker (runc) because gVisor (runsc) isn't installed on this host. Install gVisor for stronger isolation.";

/**
 * Picks the OCI runtime from what `docker info` reports. `auto` prefers
 * gVisor and falls back with a warning; asking for `runsc` explicitly fails
 * closed when the host doesn't have it.
 */
export const selectRuntime = (
  available: readonly string[],
  requested: RuntimeRequest
): Result<RuntimeChoice, string> => {
  const hasRunsc = available.includes("runsc");
  if (requested === "runsc" && !hasRunsc) {
    return err(
      "SANDBOX_RUNTIME=runsc, but the Docker daemon has no runsc runtime; refusing to fall back"
    );
  }
  if (requested !== "runc" && hasRunsc) {
    return ok({ isolation: "gvisor", runtime: "runsc", warning: null });
  }
  return ok({
    isolation: "container",
    runtime: "runc",
    warning:
      requested === "runc"
        ? "SANDBOX_RUNTIME=runc forces plain Docker isolation."
        : RUNC_WARNING,
  });
};

export interface ContainerDefaults {
  readonly image: string;
  readonly pidsLimit: number;
  readonly runtime: RunnerRuntime;
  /** `StorageOpt.size` needs overlay2 on xfs with pquota; off by default. */
  readonly storageQuota: boolean;
  readonly tmpMb: number;
  /** `uid:gid`; never root. */
  readonly user: string;
}

export interface SandboxContainerInput {
  readonly defaults: ContainerDefaults;
  readonly egress: EgressPolicy;
  readonly id: SandboxId;
  readonly limits: SandboxLimits;
}

const MIB = 1024 * 1024;

const hardening = (runtime: RunnerRuntime) => ({
  CapDrop: ["ALL"],
  // `init` reaps the zombies dev servers leave behind.
  Init: true,
  IpcMode: "private",
  Privileged: false,
  ReadonlyRootfs: true,
  RestartPolicy: { Name: "no" },
  Runtime: runtime,
  SecurityOpt: ["no-new-privileges:true"],
});

const proxyEnv = (egress: EgressPolicy): string[] =>
  egress.mode === "allowlist"
    ? ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].map(
        (name) => `${name}=${egress.proxyUrl}`
      )
    : [];

/** The effective policy for one sandbox: its own `network: false` always wins. */
export const effectiveEgress = (
  policy: EgressPolicy,
  limits: Pick<SandboxLimits, "network">
): EgressPolicy => (limits.network ? policy : { mode: "none" });

/** The create options for a sandbox's long-lived container. */
export const buildContainerSpec = ({
  defaults,
  egress,
  id,
  limits,
}: SandboxContainerInput): ContainerCreateOptions => {
  const policy = effectiveEgress(egress, limits);
  return {
    // Commands arrive through `exec`; the container itself only idles.
    Cmd: ["sleep", "infinity"],
    Env: [`HOME=${SANDBOX_HOME}`, "TERM=xterm-256color", ...proxyEnv(policy)],
    HostConfig: {
      ...hardening(defaults.runtime),
      Memory: limits.memoryMb * MIB,
      // Equal to Memory: no swap on top.
      MemorySwap: limits.memoryMb * MIB,
      Mounts: [
        {
          ReadOnly: false,
          Source: volumeName(id),
          Target: WORKDIR,
          Type: "volume",
        },
      ],
      NanoCpus: Math.round(limits.cpu * 1e9),
      NetworkMode: networkName(id),
      PidsLimit: defaults.pidsLimit,
      ...(defaults.storageQuota && limits.diskMb
        ? { StorageOpt: { size: `${limits.diskMb}M` } }
        : {}),
      Tmpfs: {
        [SANDBOX_HOME]: `rw,nosuid,nodev,size=${defaults.tmpMb}m,uid=${defaults.user.split(":")[0]}`,
        "/tmp": `rw,nosuid,nodev,size=${defaults.tmpMb}m`,
      },
    },
    Image: defaults.image,
    Labels: { [MANAGED_LABEL]: "true", [SANDBOX_LABEL]: id },
    name: containerName(id),
    User: defaults.user,
    WorkingDir: WORKDIR,
  };
};

export interface HelperInput {
  /** Root, for the one-off `chown` of a fresh volume. */
  readonly asRoot?: boolean;
  readonly cmd: readonly string[];
  readonly defaults: ContainerDefaults;
  readonly id: SandboxId;
  readonly mounts: readonly {
    readonly readOnly: boolean;
    readonly source: string;
    readonly target: string;
  }[];
}

/**
 * A short-lived container for volume chores (preparing a fresh volume,
 * copying a snapshot): same image and hardening, no network at all.
 */
export const buildHelperSpec = ({
  asRoot = false,
  cmd,
  defaults,
  id,
  mounts,
}: HelperInput): ContainerCreateOptions => ({
  Cmd: [...cmd],
  HostConfig: {
    ...hardening(defaults.runtime),
    // Root may only change ownership, nothing else.
    CapAdd: asRoot ? ["CHOWN", "FOWNER"] : [],
    Memory: 256 * MIB,
    MemorySwap: 256 * MIB,
    Mounts: mounts.map((mount) => ({
      ReadOnly: mount.readOnly,
      Source: mount.source,
      Target: mount.target,
      Type: "volume" as const,
    })),
    NanoCpus: 1e9,
    NetworkMode: "none",
    PidsLimit: 64,
  },
  Image: defaults.image,
  Labels: { [MANAGED_LABEL]: "true", [SANDBOX_LABEL]: id },
  User: asRoot ? "0:0" : defaults.user,
});

/** The sandbox's own network: `internal` has no route to the outside world. */
export const buildNetworkSpec = (id: SandboxId) => ({
  Internal: true,
  Labels: { [MANAGED_LABEL]: "true", [SANDBOX_LABEL]: id },
  Name: networkName(id),
});

/** The preview URL for a port, from a template like `http://{id}-{port}.sandbox.localhost:7071`. */
export const previewUrl = (template: string, id: SandboxId, port: number) =>
  template.replaceAll("{id}", id).replaceAll("{port}", String(port));

const PREVIEW_HOST =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{1,5})\./;

/** Reads `{id}-{port}.` back out of a preview request's Host header. */
export const parsePreviewHost = (
  host: string
): { readonly id: string; readonly port: number } | null => {
  const match = PREVIEW_HOST.exec(host.toLowerCase());
  if (!(match?.[1] && match[2])) {
    return null;
  }
  const port = Number(match[2]);
  return port >= 1 && port <= 65_535 ? { id: match[1], port } : null;
};
