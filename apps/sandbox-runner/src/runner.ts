import type { SandboxId } from "@workspace/contract/schemas/common";
import type {
  ExecResult,
  FileEntry,
  SandboxStatus,
} from "@workspace/contract/schemas/sandbox";
import { capOutput, MAX_OUTPUT_CHARS } from "@workspace/sandbox/output";
import { resolveSandboxPath, WORKDIR } from "@workspace/sandbox/paths";
import type { SandboxError } from "@workspace/sandbox/ports/sandbox";
import {
  type CreateRequest,
  type ExecRequest,
  MAX_FILE_BYTES,
  type RunnerStatus,
} from "@workspace/sandbox/runner/protocol";
import {
  type RunnerUnavailableReason,
  runnerUnavailableError,
} from "@workspace/sandbox/runner/unavailable";
import { newId } from "@workspace/shared/ids";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import type { DockerPort, OutputSink } from "./docker-port";
import {
  buildContainerSpec,
  buildHelperSpec,
  buildNetworkSpec,
  type ContainerDefaults,
  containerName,
  EGRESS_ALLOW_LABEL,
  EGRESS_NETWORK,
  type EgressPolicy,
  effectiveEgress,
  MANAGED_LABEL,
  networkName,
  previewUrl,
  type RuntimeChoice,
  SANDBOX_LABEL,
  volumeName,
} from "./spec";

// The runner's core: sandboxes as Docker containers, over the DockerPort.
// Every operation returns a Result; a Docker failure is `unavailable` with a
// safe message (the cause goes to the log, never to the caller).

export interface RunnerConfig {
  readonly choice: RuntimeChoice;
  readonly defaults: ContainerDefaults;
  /** The image `desktop` sandboxes run (172). */
  readonly desktopImage: string;
  /** The egress proxy as sandboxes reach it; `null` turns `allowlist` into `none`. */
  readonly egressProxyUrl: string | null;
  /** Stop a sandbox's container after this long without calls. */
  readonly idleMs: number;
  /** `http://{id}-{port}.sandbox.localhost:7071`; `null` turns previews off. */
  readonly previewTemplate: string | null;
  /** This runner's own container, joined to sandbox networks to reach previews. */
  readonly runnerContainer: string | null;
}

export type Log = (
  level: "info" | "warn" | "error",
  message: string,
  fields?: Record<string, unknown>
) => void;

export interface RunnerDeps {
  readonly config: RunnerConfig;
  readonly docker: DockerPort;
  readonly log: Log;
  readonly now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 120_000;
/** Base64 per `exec` argument: under Linux's 128 KiB per-argument limit. */
const WRITE_CHUNK_CHARS = 96 * 1024;
/** Exit codes our in-container scripts use for "missing" and "too big". */
const EXIT_NOT_FOUND = 44;
const EXIT_TOO_BIG = 45;
/**
 * Snapshot refs name volumes, so only ones this runner made are accepted:
 * anything else could mount another service's volume into a sandbox.
 */
const SNAPSHOT_REF =
  /^sbx-snap-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const unavailable = (message: string): SandboxError => ({
  message,
  type: "unavailable",
});

const DOCKER_DOWN_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOENT",
  "ENOTFOUND",
]);

/**
 * Whether a Docker call failed because Docker (or the socket proxy in front
 * of it) isn't there, rather than refusing this one call. Pure.
 */
export const isDockerDown = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const { code, statusCode } = cause as {
    readonly code?: unknown;
    readonly statusCode?: unknown;
  };
  return (
    (typeof code === "string" && DOCKER_DOWN_CODES.has(code)) ||
    statusCode === 502 ||
    statusCode === 503
  );
};

const FIND_TYPES: Readonly<Record<string, FileEntry["type"]>> = {
  d: "directory",
  f: "file",
  l: "symlink",
};

/** Parses `find -printf '%y\t%s\t%T@\t%p\0'` into sorted entries. */
export const parseFindOutput = (stdout: string): FileEntry[] =>
  stdout
    .split("\0")
    .flatMap((record) => {
      const [kind = "", size, mtime, ...rest] = record.split("\t");
      const path = rest.join("\t");
      const type = FIND_TYPES[kind] ?? "file";
      return path
        ? [
            {
              modifiedAt: new Date(Number(mtime) * 1000).toISOString(),
              path,
              size: type === "file" ? Number(size) : null,
              type,
            },
          ]
        : [];
    })
    .sort((a, b) => a.path.localeCompare(b.path));

/** Base64 in pieces of whole quads, so each decodes on its own. */
export const base64Chunks = (base64: string, size: number): string[] => {
  const chunks: string[] = [];
  for (let start = 0; start < base64.length; start += size) {
    chunks.push(base64.slice(start, start + size));
  }
  return chunks.length > 0 ? chunks : [""];
};

export const createRunner = ({
  config,
  docker,
  log,
  now = () => new Date(),
}: RunnerDeps) => {
  const lastUsed = new Map<SandboxId, number>();
  const previews = new Map<SandboxId, Set<number>>();
  /**
   * Sandbox networks this process has joined (or is joining). Membership lives
   * in Docker, not here: a recreated runner container starts on none of them,
   * and a new process starts with this empty, so it rejoins (ticket 069). The
   * map only saves a Docker call per preview request.
   */
  const joined = new Map<SandboxId, AsyncResult<void, SandboxError>>();
  /**
   * The egress proxy's view: an `allowlist` sandbox's hosts by its address
   * on its own network, and addresses known to have no allowlist. Both are
   * rebuilt from Docker's labels on a miss, and forgotten whenever a
   * sandbox starts or goes, since that's when addresses change hands.
   */
  const allowByIp = new Map<string, readonly string[]>();
  const deniedIps = new Set<string>();
  const forgetAddresses = () => {
    allowByIp.clear();
    deniedIps.clear();
  };

  const touch = (id: SandboxId) => lastUsed.set(id, now().getTime());

  /**
   * Runs a Docker call, turning a throw into `unavailable`: Docker itself
   * being down is `docker_unavailable`, `otherwise` names a known cause.
   */
  const guarded = async <T>(
    what: string,
    action: () => Promise<T>,
    otherwise?: RunnerUnavailableReason
  ): AsyncResult<T, SandboxError> => {
    try {
      return ok(await action());
    } catch (cause) {
      log("error", `docker: ${what} failed`, {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      if (isDockerDown(cause)) {
        return err(runnerUnavailableError("docker_unavailable"));
      }
      return err(
        otherwise
          ? runnerUnavailableError(otherwise)
          : unavailable(`the sandbox host couldn't ${what}`)
      );
    }
  };

  /** A running container for `id`, starting it if the reaper stopped it. */
  const running = async (id: SandboxId): AsyncResult<string, SandboxError> => {
    const found = await guarded("inspect the sandbox", () =>
      docker.inspectContainer(containerName(id))
    );
    if (!found.ok) {
      return found;
    }
    if (found.value === null) {
      return err({ path: id, type: "not_found" });
    }
    if (!found.value.running) {
      const started = await guarded("start the sandbox", () =>
        docker.startContainer(containerName(id))
      );
      if (!started.ok) {
        return started;
      }
      forgetAddresses();
    }
    touch(id);
    return ok(containerName(id));
  };

  /** Runs a helper container to completion and removes it. */
  const runHelper = async (
    id: SandboxId,
    spec: Parameters<typeof buildHelperSpec>[0]
  ): AsyncResult<void, SandboxError> =>
    guarded("prepare the sandbox volume", async () => {
      const helper = await docker.createContainer(buildHelperSpec(spec));
      try {
        await docker.startContainer(helper);
        const code = await docker.waitContainer(helper);
        if (code !== 0) {
          throw new Error(`helper for ${id} exited ${code}`);
        }
      } finally {
        await docker.removeContainer(helper);
      }
    });

  /** Runs a script in the sandbox and collects its output. */
  const script = async (
    container: string,
    cmd: readonly string[]
  ): AsyncResult<
    { code: number; stderr: string; stdout: string },
    SandboxError
  > => {
    let stdout = "";
    let stderr = "";
    const code = await guarded("run a command", () =>
      docker.exec(container, { cmd }, (stream, data) => {
        if (stream === "stdout") {
          stdout += data;
        } else {
          stderr += data;
        }
      })
    );
    return code.ok ? ok({ code: code.value, stderr, stdout }) : code;
  };

  /**
   * Puts the runner on the sandbox's private network, the only way to reach
   * its ports. Idempotent: Docker's "already connected" counts as joined.
   * Concurrent callers share one attempt; a failed one is forgotten, so the
   * next request tries again.
   */
  const joinNetwork = (id: SandboxId): AsyncResult<void, SandboxError> => {
    const { runnerContainer } = config;
    if (!runnerContainer) {
      return Promise.resolve(ok(undefined));
    }
    const pending = joined.get(id);
    if (pending) {
      return pending;
    }
    const attempt = guarded("join the sandbox network", () =>
      docker.connectNetwork(networkName(id), runnerContainer)
    ).then((result) => {
      if (!result.ok && joined.get(id) === attempt) {
        joined.delete(id);
      }
      return result;
    });
    joined.set(id, attempt);
    return attempt;
  };

  const resolve = (path: string) => resolveSandboxPath(path, WORKDIR);

  /** The images a sandbox runs; a desktop image can't be pulled, only built. */
  const ensureImages = async (
    image: string
  ): AsyncResult<void, SandboxError> => {
    const base = await guarded("pull the sandbox image", () =>
      docker.ensureImage(config.defaults.image)
    );
    if (!base.ok || image === config.defaults.image) {
      return base;
    }
    return guarded(
      "find the desktop image",
      () => docker.ensureImage(image),
      "desktop_image_missing"
    );
  };

  /** The volume and networks a sandbox needs, before its container. */
  const provision = (id: SandboxId, egress: EgressPolicy) =>
    guarded("create the sandbox", async () => {
      await docker.createVolume(volumeName(id), {
        [MANAGED_LABEL]: "true",
        [SANDBOX_LABEL]: id,
      });
      await docker.createNetwork(buildNetworkSpec(id));
      if (
        egress.mode === "open" &&
        !(await docker.networkExists(EGRESS_NETWORK))
      ) {
        await docker.createNetwork({
          Internal: false,
          Labels: { [MANAGED_LABEL]: "true" },
          Name: EGRESS_NETWORK,
        });
      }
    });

  /** Hands a fresh (root-owned) volume to the sandbox user. */
  const chownVolume = (id: SandboxId, volume: string) =>
    runHelper(id, {
      asRoot: true,
      cmd: ["chown", config.defaults.user, WORKDIR],
      defaults: config.defaults,
      id,
      mounts: [{ readOnly: false, source: volume, target: WORKDIR }],
    });

  /** Prepares the sandbox's volume, then fills it from a snapshot. */
  const prepareVolume = async (
    id: SandboxId,
    snapshotRef: string | undefined
  ): AsyncResult<void, SandboxError> => {
    const owned = await chownVolume(id, volumeName(id));
    if (!(owned.ok && snapshotRef)) {
      return owned;
    }
    return runHelper(id, {
      cmd: ["cp", "-a", "/from/.", `${WORKDIR}/`],
      defaults: config.defaults,
      id,
      mounts: [
        { readOnly: true, source: snapshotRef, target: "/from" },
        { readOnly: false, source: volumeName(id), target: WORKDIR },
      ],
    });
  };

  const launch = async (
    request: CreateRequest,
    egress: EgressPolicy
  ): AsyncResult<void, SandboxError> => {
    const { id, limits, variant } = request;
    // The proxy is the runner itself, so it must be on the sandbox's
    // network before the sandbox's first request.
    if (egress.mode === "allowlist") {
      const joinedFirst = await joinNetwork(id);
      if (!joinedFirst.ok) {
        return joinedFirst;
      }
    }
    const started = await guarded("start the sandbox", async () => {
      await docker.createContainer(
        buildContainerSpec({
          defaults: config.defaults,
          desktopImage: config.desktopImage,
          egress,
          egressProxyUrl: config.egressProxyUrl ?? undefined,
          id,
          limits,
          variant,
        })
      );
      if (egress.mode === "open") {
        await docker.connectNetwork(EGRESS_NETWORK, containerName(id));
      }
      await docker.startContainer(containerName(id));
    });
    forgetAddresses();
    if (started.ok && config.previewTemplate) {
      // Best effort: without it previews fail, commands still work.
      const reachable = await joinNetwork(id);
      if (!reachable.ok) {
        log("warn", "previews unavailable for sandbox", { id });
      }
    }
    return started;
  };

  const create = async (
    request: CreateRequest
  ): AsyncResult<SandboxStatus, SandboxError> => {
    const { id, limits, snapshotRef } = request;
    if (snapshotRef !== undefined && !SNAPSHOT_REF.test(snapshotRef)) {
      return err({ path: snapshotRef, type: "not_found" });
    }
    const existing = await guarded("inspect the sandbox", () =>
      docker.inspectContainer(containerName(id))
    );
    if (!existing.ok) {
      return existing;
    }
    // Idempotent: a retried create finds the sandbox the first one made.
    if (existing.value) {
      touch(id);
      return ok({ state: existing.value.running ? "ready" : "stopped" });
    }
    const egress = effectiveEgress(
      request.egress,
      limits,
      config.egressProxyUrl ?? undefined
    );
    const steps = [
      () =>
        ensureImages(
          request.variant === "desktop"
            ? config.desktopImage
            : config.defaults.image
        ),
      () => provision(id, egress),
      () => prepareVolume(id, snapshotRef),
      () => launch(request, egress),
    ];
    for (const step of steps) {
      // biome-ignore lint/performance/noAwaitInLoops: each step needs the one before it.
      const done = await step();
      if (!done.ok) {
        return done;
      }
    }
    touch(id);
    log("info", "sandbox created", { id, runtime: config.choice.runtime });
    return ok({ state: "ready" });
  };

  const state = async (
    id: SandboxId
  ): AsyncResult<SandboxStatus, SandboxError> => {
    const found = await guarded("inspect the sandbox", () =>
      docker.inspectContainer(containerName(id))
    );
    if (!found.ok) {
      return found;
    }
    if (found.value === null) {
      return err({ path: id, type: "not_found" });
    }
    return ok({ state: found.value.running ? "ready" : "stopped" });
  };

  const exec = async (
    id: SandboxId,
    request: ExecRequest,
    onOutput: OutputSink,
    signal?: AbortSignal
  ): AsyncResult<ExecResult, SandboxError> => {
    const cwd = resolve(request.cwd ?? WORKDIR);
    if (!cwd.ok) {
      return cwd;
    }
    const container = await running(id);
    if (!container.ok) {
      return container;
    }
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = now().getTime();
    const collected = { stderr: "", stdout: "" };
    // Keep head and tail for the result; stop streaming past the ceiling.
    const ceiling = MAX_OUTPUT_CHARS * 4;
    let forwarded = 0;
    const code = await guarded("run the command", () =>
      docker.exec(
        container.value,
        {
          // `timeout` inside the container does the killing, so an
          // abandoned request can't leave a runaway process behind.
          cmd: [
            "timeout",
            "-s",
            "KILL",
            `${Math.ceil(timeoutMs / 1000)}s`,
            "bash",
            "-c",
            request.command,
          ],
          env: Object.entries(request.env ?? {}).map(
            ([name, value]) => `${name}=${value}`
          ),
          workdir: cwd.value,
        },
        (stream, data) => {
          if (collected[stream].length < ceiling) {
            collected[stream] += data;
          }
          if (forwarded < ceiling) {
            forwarded += data.length;
            onOutput(stream, data);
          }
        },
        signal
      )
    );
    if (!code.ok) {
      return code;
    }
    touch(id);
    const elapsed = now().getTime() - started;
    const stdout = capOutput(collected.stdout);
    const stderr = capOutput(collected.stderr);
    return ok({
      durationMs: Math.max(0, elapsed),
      exitCode: code.value,
      stderr: stderr.text,
      stdout: stdout.text,
      // `timeout -s KILL` exits 137 when it fires.
      timedOut: code.value === 137 && elapsed >= timeoutMs - 1000,
      truncated:
        stdout.truncated ||
        stderr.truncated ||
        collected.stdout.length >= ceiling ||
        collected.stderr.length >= ceiling,
    });
  };

  const listFiles = async (
    id: SandboxId,
    path: string,
    recursive: boolean
  ): AsyncResult<FileEntry[], SandboxError> => {
    const resolved = resolve(path);
    if (!resolved.ok) {
      return resolved;
    }
    const container = await running(id);
    if (!container.ok) {
      return container;
    }
    const output = await script(container.value, [
      "find",
      resolved.value,
      "-mindepth",
      "1",
      ...(recursive ? [] : ["-maxdepth", "1"]),
      "-printf",
      "%y\\t%s\\t%T@\\t%p\\0",
    ]);
    if (!output.ok) {
      return output;
    }
    if (output.value.code !== 0) {
      return err({ path, type: "not_found" });
    }
    return ok(parseFindOutput(output.value.stdout));
  };

  const readFile = async (
    id: SandboxId,
    path: string
  ): AsyncResult<string, SandboxError> => {
    const resolved = resolve(path);
    if (!resolved.ok) {
      return resolved;
    }
    const container = await running(id);
    if (!container.ok) {
      return container;
    }
    const output = await script(container.value, [
      "sh",
      "-c",
      `[ -f "$1" ] || exit ${EXIT_NOT_FOUND}; [ "$(stat -c %s "$1")" -le "$2" ] || exit ${EXIT_TOO_BIG}; base64 -w0 "$1"`,
      "sh",
      resolved.value,
      String(MAX_FILE_BYTES),
    ]);
    if (!output.ok) {
      return output;
    }
    switch (output.value.code) {
      case 0:
        return ok(output.value.stdout.trim());
      case EXIT_NOT_FOUND:
        return err({ path, type: "not_found" });
      case EXIT_TOO_BIG:
        return err({
          message: `${path} is larger than ${MAX_FILE_BYTES} bytes`,
          type: "limit_exceeded",
        });
      default:
        return err(unavailable(`couldn't read ${path}`));
    }
  };

  const writeChunk = async (
    container: string,
    path: string,
    chunk: string,
    append: boolean
  ): AsyncResult<void, SandboxError> => {
    const output = await script(container, [
      "sh",
      "-c",
      `mkdir -p "$(dirname "$1")" && printf %s "$2" | base64 -d ${append ? ">>" : ">"} "$1"`,
      "sh",
      path,
      chunk,
    ]);
    if (!output.ok) {
      return output;
    }
    return output.value.code === 0
      ? ok(undefined)
      : err({ message: output.value.stderr.trim(), type: "limit_exceeded" });
  };

  const writeFile = async (
    id: SandboxId,
    path: string,
    base64: string
  ): AsyncResult<void, SandboxError> => {
    const resolved = resolve(path);
    if (!resolved.ok) {
      return resolved;
    }
    const container = await running(id);
    if (!container.ok) {
      return container;
    }
    // No stdin through the proxy, so the bytes go in as arguments, in chunks.
    for (const [index, chunk] of base64Chunks(
      base64,
      WRITE_CHUNK_CHARS
    ).entries()) {
      // biome-ignore lint/performance/noAwaitInLoops: chunks append in order.
      const written = await writeChunk(
        container.value,
        resolved.value,
        chunk,
        index > 0
      );
      if (!written.ok) {
        return err(
          written.error.type === "unavailable"
            ? written.error
            : { message: `couldn't write ${path}`, type: "limit_exceeded" }
        );
      }
    }
    return ok(undefined);
  };

  const exposePort = async (
    id: SandboxId,
    port: number
  ): AsyncResult<{ port: number; url: string }, SandboxError> => {
    if (!config.previewTemplate) {
      return err({ operation: "exposePort", type: "unsupported" });
    }
    const container = await running(id);
    if (!container.ok) {
      return container;
    }
    // A URL the runner can't reach would only hang, so say so instead.
    const reachable = await joinNetwork(id);
    if (!reachable.ok) {
      return err(
        unavailable(
          "the sandbox host couldn't reach the sandbox's network, so previews can't load"
        )
      );
    }
    const ports = previews.get(id) ?? new Set<number>();
    ports.add(port);
    previews.set(id, ports);
    return ok({ port, url: previewUrl(config.previewTemplate, id, port) });
  };

  /** Where the preview proxy sends a request, if `port` was exposed. */
  const previewTarget = async (
    id: SandboxId,
    port: number
  ): Promise<string | null> => {
    if (!previews.get(id)?.has(port)) {
      return null;
    }
    // Best effort: if Docker refuses, the proxy's fetch fails and answers 502.
    await joinNetwork(id);
    const found = await guarded("inspect the sandbox", () =>
      docker.inspectContainer(containerName(id))
    );
    const ip = found.ok ? found.value?.ips[networkName(id)] : undefined;
    if (!ip) {
      return null;
    }
    touch(id);
    return `http://${ip}:${port}`;
  };

  const snapshot = async (
    id: SandboxId
  ): AsyncResult<{ ref: string }, SandboxError> => {
    const container = await running(id);
    if (!container.ok) {
      return container;
    }
    const ref = `sbx-snap-${newId("snapshot")}`;
    const made = await guarded("create the snapshot", () =>
      docker.createVolume(ref, { [MANAGED_LABEL]: "true", [SANDBOX_LABEL]: id })
    );
    if (!made.ok) {
      return made;
    }
    // The copy runs as the sandbox user, so it needs the new volume first.
    const owned = await chownVolume(id, ref);
    if (!owned.ok) {
      return owned;
    }
    const copied = await runHelper(id, {
      cmd: ["cp", "-a", `${WORKDIR}/.`, "/to/"],
      defaults: config.defaults,
      id,
      mounts: [
        { readOnly: true, source: volumeName(id), target: WORKDIR },
        { readOnly: false, source: ref, target: "/to" },
      ],
    });
    return copied.ok ? ok({ ref }) : copied;
  };

  const destroy = async (id: SandboxId): AsyncResult<void, SandboxError> => {
    const removed = await guarded("remove the sandbox", async () => {
      await docker.removeContainer(containerName(id));
      // Docker won't remove a network the runner is still attached to.
      if (config.runnerContainer) {
        await docker.disconnectNetwork(networkName(id), config.runnerContainer);
      }
      await docker.removeNetwork(networkName(id));
      await docker.removeVolume(volumeName(id));
    });
    lastUsed.delete(id);
    previews.delete(id);
    joined.delete(id);
    forgetAddresses();
    return removed;
  };

  /** Stops and starts a sandbox's container, keeping its volume. */
  const restart = async (
    id: SandboxId
  ): AsyncResult<SandboxStatus, SandboxError> => {
    const found = await state(id);
    if (!found.ok) {
      return found;
    }
    const restarted = await guarded("restart the sandbox", async () => {
      await docker.stopContainer(containerName(id));
      await docker.startContainer(containerName(id));
    });
    if (!restarted.ok) {
      return restarted;
    }
    touch(id);
    return ok({ state: "ready" });
  };

  /** Stops containers idle past `idleMs`; the next call starts them again. */
  const reapIdle = async (): Promise<SandboxId[]> => {
    const cutoff = now().getTime() - config.idleMs;
    const idle = [...lastUsed].filter(([, used]) => used <= cutoff);
    const stopped = await Promise.all(
      idle.map(async ([id]) => ({
        id,
        stopped: await guarded("stop an idle sandbox", () =>
          docker.stopContainer(containerName(id))
        ),
      }))
    );
    const reaped = stopped
      .filter((entry) => entry.stopped.ok)
      .map((entry) => entry.id);
    for (const id of reaped) {
      lastUsed.delete(id);
    }
    return reaped;
  };

  /**
   * After a restart: counts running sandboxes as just used so the reaper sees
   * them, and rejoins their networks, since a recreated runner container is on
   * none of them (ticket 069). Stopped sandboxes rejoin when next used.
   * Exposed ports aren't restored; the server re-exposes what it recorded.
   */
  const recover = async (): AsyncResult<
    { readonly rejoined: number; readonly running: number },
    SandboxError
  > => {
    const found = await guarded("list sandboxes", () =>
      docker.listContainers(MANAGED_LABEL, "true")
    );
    if (!found.ok) {
      return found;
    }
    const ids = new Set<SandboxId>();
    for (const container of found.value) {
      const id = container.labels[SANDBOX_LABEL] as SandboxId | undefined;
      if (id && container.running) {
        touch(id);
        ids.add(id);
      }
    }
    // Previews and the egress proxy both need the runner on each network.
    const rejoins = await Promise.all([...ids].map((id) => joinNetwork(id)));
    return ok({
      rejoined: rejoins.filter((result) => result.ok).length,
      running: ids.size,
    });
  };

  /**
   * The hosts the sandbox at `ip` may reach through the egress proxy, or
   * `null` when it isn't an `allowlist` sandbox this Docker host knows.
   */
  const egressAllowFor = async (
    ip: string
  ): Promise<readonly string[] | null> => {
    const known = allowByIp.get(ip);
    if (known || deniedIps.has(ip)) {
      return known ?? null;
    }
    const found = await guarded("list allowlisted sandboxes", () =>
      docker.listContainers(EGRESS_ALLOW_LABEL)
    );
    if (!found.ok) {
      return null;
    }
    for (const container of found.value) {
      const id = container.labels[SANDBOX_LABEL];
      const address = id ? container.ips[networkName(id as SandboxId)] : null;
      if (address && container.running) {
        allowByIp.set(
          address,
          (container.labels[EGRESS_ALLOW_LABEL] ?? "")
            .split(",")
            .filter(Boolean)
        );
      }
    }
    const allow = allowByIp.get(ip) ?? null;
    if (!allow) {
      deniedIps.add(ip);
    }
    return allow;
  };

  const status = (): RunnerStatus => ({
    isolation: config.choice.isolation,
    runtime: config.choice.runtime,
    sandboxes: lastUsed.size,
    warning: config.choice.warning,
  });

  return {
    create,
    destroy,
    egressAllowFor,
    exec,
    exposePort,
    listFiles,
    previewTarget,
    readFile,
    reapIdle,
    recover,
    restart,
    snapshot,
    state,
    status,
    writeFile,
  };
};

export type Runner = ReturnType<typeof createRunner>;
