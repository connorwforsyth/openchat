import type { SandboxId } from "@workspace/contract/schemas/common";
import type {
  ExecResult,
  FileEntry,
  SandboxLimits,
} from "@workspace/contract/schemas/sandbox";
import { newId } from "@workspace/shared/ids";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import {
  Bash,
  type BashExecResult,
  type IFileSystem,
  InMemoryFs,
} from "just-bash";

import { capOutput } from "../output";
import { resolveSandboxPath, WORKDIR } from "../paths";
import type {
  CreateSandboxSpec,
  ExecOptions,
  Sandbox,
  SandboxError,
  SandboxFactory,
} from "../ports/sandbox";
import type { SnapshotStore } from "./snapshot-store";
import {
  captureWorkspace,
  decodeState,
  encodeState,
  restoreWorkspace,
  type WorkspaceState,
} from "./state";

// The default per-chat scratch workspace (D7): just-bash, a simulated bash
// over an in-memory filesystem. It spawns no processes and has no network,
// so it's safe in the web process and in the browser. After every change the
// workdir is serialised and handed to the store, so the workspace outlives
// the process; `attach` after a restart reloads it.

const DEFAULT_TIMEOUT_MS = 60_000;
/** just-bash's own backstop, above any single exec's timeout. */
const MAX_EXECUTION_MS = 10 * 60_000;
const MIB = 1024 * 1024;

/**
 * Whether just-bash's defense-in-depth layer can run in this process. While
 * a command runs it swaps dangerous globals (`performance`, `WeakRef`,
 * `Error.prepareStackTrace`, `process.env`, …) for proxies that throw when
 * reached from the command's async context. React's development server
 * renderer, which `next dev` loads, installs a process-wide async hook that
 * times every promise and timer with exactly those globals, and async hooks
 * run in the context of whatever created the resource: a `sleep` in the
 * sandbox reaches `Error.prepareStackTrace` through React. A throw from an
 * async hook is fatal to Node, so the dev server died mid tool call (076).
 * Setting `Error.prepareStackTrace` can't be excluded, so the layer is off
 * under `next dev` alone; production (no such hook) and tests keep it. The
 * sandbox itself doesn't change: an in-memory filesystem, no processes, no
 * network, no JavaScript or Python.
 */
export const defenseInDepthFor = (env: {
  readonly NODE_ENV?: string;
}): boolean => env.NODE_ENV !== "development";

/** The key a sandbox's live workspace is saved under. */
export const liveKey = (id: SandboxId) => `live/${id}`;

export interface JustBashSandboxOptions {
  /** just-bash's defense-in-depth layer; on unless `defenseInDepthFor` says not. */
  readonly defenseInDepth?: boolean;
  readonly id: SandboxId;
  /** The workspace to start from (a snapshot, or the last saved state). */
  readonly initial?: WorkspaceState;
  /** `diskMb` caps the in-memory filesystem; the rest don't apply here. */
  readonly limits?: Pick<SandboxLimits, "diskMb">;
  readonly now?: () => Date;
  /** Where the live workspace and snapshots are saved; omit to keep nothing. */
  readonly store?: SnapshotStore;
}

const notFound = (path: string): SandboxError => ({ path, type: "not_found" });

const alreadyDestroyed = () =>
  Promise.resolve(err({ type: "destroyed" as const }));

const listDirectory = async (
  fs: IFileSystem,
  dir: string,
  recursive: boolean
): Promise<FileEntry[]> => {
  const names = [...(await fs.readdir(dir))].sort();
  const listed = await Promise.all(
    names.map(async (name): Promise<FileEntry[]> => {
      const path = dir === "/" ? `/${name}` : `${dir}/${name}`;
      const stat = await fs.lstat(path);
      let type: FileEntry["type"] = "file";
      if (stat.isSymbolicLink) {
        type = "symlink";
      } else if (stat.isDirectory) {
        type = "directory";
      }
      const entry: FileEntry = {
        modifiedAt: stat.mtime.toISOString(),
        path,
        size: type === "file" ? stat.size : null,
        type,
      };
      return recursive && type === "directory"
        ? [entry, ...(await listDirectory(fs, path, true))]
        : [entry];
    })
  );
  return listed.flat();
};

/**
 * A failing command is an exit code; a throw means the interpreter itself
 * gave up (a defense-in-depth violation, say). That's this command's error,
 * for the agent to see, not the process's.
 */
const runBash = async (
  bash: Bash,
  command: string,
  options: Parameters<Bash["exec"]>[1]
): AsyncResult<BashExecResult, SandboxError> => {
  try {
    return ok(await bash.exec(command, options));
  } catch (cause) {
    return err({
      message: cause instanceof Error ? cause.message : "the command failed",
      type: "unavailable",
    });
  }
};

export const createJustBashSandbox = async ({
  defenseInDepth = true,
  id,
  initial,
  limits,
  now = () => new Date(),
  store,
}: JustBashSandboxOptions): Promise<Sandbox> => {
  const fs = new InMemoryFs(undefined, {
    ...(limits?.diskMb ? { maxTotalBytes: limits.diskMb * MIB } : {}),
  });
  await fs.mkdir(WORKDIR, { recursive: true });
  if (initial) {
    await restoreWorkspace(fs, initial);
  }
  const bash = new Bash({
    cwd: WORKDIR,
    defenseInDepth,
    executionLimitProfile: "hardened",
    executionLimits: {
      maxExecutionTimeMs: MAX_EXECUTION_MS,
      ...(limits?.diskMb ? { maxFileSystemBytes: limits.diskMb * MIB } : {}),
    },
    fs,
  });
  let destroyed = false;
  // Saves run one after another, so an older state never lands last.
  let saving: Promise<Result<void, SandboxError>> = Promise.resolve(
    ok(undefined)
  );

  const persist = (): Promise<Result<void, SandboxError>> => {
    if (!store) {
      return Promise.resolve(ok(undefined));
    }
    saving = saving.then(async () =>
      store.save(liveKey(id), encodeState(await captureWorkspace(fs)))
    );
    return saving;
  };

  const resolve = (path: string) => resolveSandboxPath(path);

  const exec = async (
    command: string,
    options: ExecOptions = {}
  ): AsyncResult<ExecResult, SandboxError> => {
    if (destroyed) {
      return alreadyDestroyed();
    }
    const cwd = resolve(options.cwd ?? WORKDIR);
    if (!cwd.ok) {
      return cwd;
    }
    const started = now().getTime();
    const timeout = AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    const ran = await runBash(bash, command, {
      cwd: cwd.value,
      env: options.env ? { ...options.env } : undefined,
      signal,
    });
    if (!ran.ok) {
      return ran;
    }
    const result = ran.value;
    // just-bash doesn't stream, so the log gets each stream once, in order.
    if (result.stdout) {
      options.onOutput?.({ data: result.stdout, stream: "stdout" });
    }
    if (result.stderr) {
      options.onOutput?.({ data: result.stderr, stream: "stderr" });
    }
    const saved = await persist();
    if (!saved.ok) {
      return saved;
    }
    const stdout = capOutput(result.stdout);
    const stderr = capOutput(result.stderr);
    return ok({
      durationMs: Math.max(0, now().getTime() - started),
      exitCode: result.exitCode,
      stderr: stderr.text,
      stdout: stdout.text,
      timedOut: timeout.aborted,
      truncated: stdout.truncated || stderr.truncated,
    });
  };

  return {
    destroy: async () => {
      if (destroyed) {
        return ok(undefined);
      }
      destroyed = true;
      await saving;
      return store ? store.remove(liveKey(id)) : ok(undefined);
    },

    exec,

    // Nothing listens inside a simulation, so there's nothing to preview.
    exposePort: () =>
      destroyed
        ? alreadyDestroyed()
        : Promise.resolve(
            err({ operation: "exposePort", type: "unsupported" as const })
          ),

    id,

    listFiles: async (path, options = {}) => {
      if (destroyed) {
        return alreadyDestroyed();
      }
      const resolved = resolve(path);
      if (!resolved.ok) {
        return resolved;
      }
      const exists = await fs.exists(resolved.value);
      if (!(exists && (await fs.stat(resolved.value)).isDirectory)) {
        return err(notFound(path));
      }
      return ok(
        await listDirectory(fs, resolved.value, options.recursive ?? false)
      );
    },

    provider: "just-bash",

    readFile: async (path) => {
      if (destroyed) {
        return alreadyDestroyed();
      }
      const resolved = resolve(path);
      if (!resolved.ok) {
        return resolved;
      }
      if (
        !(
          (await fs.exists(resolved.value)) &&
          (await fs.stat(resolved.value)).isFile
        )
      ) {
        return err(notFound(path));
      }
      return ok(await fs.readFileBuffer(resolved.value));
    },

    snapshot: async () => {
      if (destroyed) {
        return alreadyDestroyed();
      }
      if (!store) {
        return err({
          message: "no workspace store is configured",
          type: "unavailable" as const,
        });
      }
      const ref = `snapshot/${id}/${newId("snapshot")}`;
      const saved = await store.save(
        ref,
        encodeState(await captureWorkspace(fs))
      );
      return saved.ok ? ok({ ref }) : saved;
    },

    status: () =>
      destroyed
        ? alreadyDestroyed()
        : Promise.resolve(ok({ state: "ready" as const })),

    writeFile: async (path, content) => {
      if (destroyed) {
        return alreadyDestroyed();
      }
      const resolved = resolve(path);
      if (!resolved.ok) {
        return resolved;
      }
      const parent = resolved.value.slice(0, resolved.value.lastIndexOf("/"));
      try {
        if (parent) {
          await fs.mkdir(parent, { recursive: true });
        }
        await fs.writeFile(resolved.value, content);
      } catch (cause) {
        // The filesystem's byte budget is the only expected failure here.
        return err({
          message: cause instanceof Error ? cause.message : "write failed",
          type: "limit_exceeded" as const,
        });
      }
      return persist();
    },
  };
};

const loadState = async (
  store: SnapshotStore,
  key: string
): AsyncResult<WorkspaceState | null, SandboxError> => {
  const loaded = await store.load(key);
  if (!loaded.ok) {
    return loaded;
  }
  return loaded.value === null ? ok(null) : decodeState(loaded.value);
};

export interface JustBashFactoryOptions {
  /** See `defenseInDepthFor`; on by default. */
  readonly defenseInDepth?: boolean;
  readonly now?: () => Date;
  readonly store: SnapshotStore;
}

/**
 * just-bash sandboxes for the server. Live sandboxes are cached in this
 * process; `attach` rebuilds one from its saved workspace after a restart.
 */
export const createJustBashFactory = ({
  defenseInDepth,
  now,
  store,
}: JustBashFactoryOptions): SandboxFactory => {
  const live = new Map<SandboxId, Sandbox>();

  const start = async (
    id: SandboxId,
    limits: Pick<SandboxLimits, "diskMb"> | undefined,
    initial: WorkspaceState | undefined
  ): AsyncResult<Sandbox, SandboxError> => {
    const sandbox = await createJustBashSandbox({
      defenseInDepth,
      id,
      initial,
      limits,
      now,
      store,
    });
    const tracked: Sandbox = {
      ...sandbox,
      destroy: () => {
        live.delete(id);
        return sandbox.destroy();
      },
    };
    live.set(id, tracked);
    return ok(tracked);
  };

  return {
    attach: async (id) => {
      const cached = live.get(id);
      if (cached) {
        return ok(cached);
      }
      const state = await loadState(store, liveKey(id));
      if (!state.ok) {
        return state;
      }
      if (state.value === null) {
        return err({ message: `no sandbox ${id}`, type: "unavailable" });
      }
      return start(id, undefined, state.value);
    },

    create: async (spec: CreateSandboxSpec) => {
      let initial: WorkspaceState | undefined;
      if (spec.snapshotRef) {
        const state = await loadState(store, spec.snapshotRef);
        if (!state.ok) {
          return state;
        }
        if (state.value === null) {
          return err(notFound(spec.snapshotRef));
        }
        initial = state.value;
      }
      const started = await start(spec.id, spec.limits, initial);
      if (started.ok) {
        // Save straight away, so a restart before the first command still
        // finds the sandbox.
        const saved = await store.save(
          liveKey(spec.id),
          encodeState(initial ?? { entries: [], version: 1 })
        );
        if (!saved.ok) {
          return saved;
        }
      }
      return started;
    },

    provider: "just-bash",
  };
};
