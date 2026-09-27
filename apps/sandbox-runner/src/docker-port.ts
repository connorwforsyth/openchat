import type { ContainerCreateOptions } from "dockerode";

// The slice of the Docker Engine API the runner uses, as a port (D8): the
// dockerode adapter implements it against the socket proxy, the fake in
// tests. Keeping it this small is also the allowlist for the proxy: only
// containers, exec, images (pull), networks, volumes and info are needed.

export interface ContainerState {
  readonly id: string;
  /** IP address on each attached network, by network name. */
  readonly ips: Readonly<Record<string, string>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly running: boolean;
}

export interface ExecSpec {
  readonly cmd: readonly string[];
  readonly env?: readonly string[];
  readonly workdir?: string;
}

export type OutputSink = (stream: "stdout" | "stderr", data: string) => void;

export interface DockerPort {
  /** Attaches a container to a network (idempotent). */
  connectNetwork: (network: string, container: string) => Promise<void>;
  /** Creates and returns the container id; does not start it. */
  createContainer: (spec: ContainerCreateOptions) => Promise<string>;
  createNetwork: (spec: {
    readonly Internal: boolean;
    readonly Labels: Readonly<Record<string, string>>;
    readonly Name: string;
  }) => Promise<void>;
  createVolume: (
    name: string,
    labels: Readonly<Record<string, string>>
  ) => Promise<void>;
  /** Detaches a container from a network; not attached is fine. */
  disconnectNetwork: (network: string, container: string) => Promise<void>;
  /** Pulls the image unless it's already present. */
  ensureImage: (image: string) => Promise<void>;
  /** Runs a command in a running container, streaming output; resolves with the exit code. */
  exec: (
    container: string,
    spec: ExecSpec,
    onOutput: OutputSink,
    signal?: AbortSignal
  ) => Promise<number>;
  /** `null` when there's no such container. */
  inspectContainer: (nameOrId: string) => Promise<ContainerState | null>;
  /** Containers carrying `label=value`, running or not. */
  listContainers: (
    label: string,
    value?: string
  ) => Promise<readonly ContainerState[]>;
  /** Names of the OCI runtimes the daemon offers (`docker info` → Runtimes). */
  listRuntimes: () => Promise<string[]>;
  networkExists: (name: string) => Promise<boolean>;
  /** Removes (force) a container; missing is fine. */
  removeContainer: (nameOrId: string) => Promise<void>;
  /** Fails while any container is still attached, as Docker does. */
  removeNetwork: (name: string) => Promise<void>;
  removeVolume: (name: string) => Promise<void>;
  startContainer: (nameOrId: string) => Promise<void>;
  stopContainer: (nameOrId: string) => Promise<void>;
  /** Waits for a container to exit; resolves with its exit code. */
  waitContainer: (nameOrId: string) => Promise<number>;
}
