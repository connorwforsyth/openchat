import type { SandboxId } from "@workspace/contract/schemas/common";
import type {
  ExecResult,
  FileEntry,
} from "@workspace/contract/schemas/sandbox";
import { err, ok, type Result } from "@workspace/shared/result";

import type {
  CreateSandboxSpec,
  ExecOptions,
  Sandbox,
  SandboxError,
  SandboxFactory,
} from "./sandbox";

// An in-memory Sandbox for tests: a map of files and a toy shell with `echo`,
// `cat`, `ls`, `pwd`, `mkdir`, `rm`, `true`, `false`, `&&` and `>`/`>>`.
// Enough for PLAN.md §11's `ls && echo hi > a.txt && cat a.txt`; anything
// else exits 127, or is handled by a `commands` override.

const WORKDIR = "/work";
/** `command > file` or `command >> file` at the end of a segment. */
const REDIRECT = /^(.*?)\s*(>>?)\s*(\S+)\s*$/;
const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;

type Files = Map<string, Uint8Array>;

export type FakeCommand = (
  args: readonly string[],
  context: { readonly cwd: string; readonly files: Files }
) => { exitCode: number; stderr?: string; stdout?: string };

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Resolves `path` against `cwd`, refusing to climb out of `/`. */
export const resolvePath = (
  path: string,
  cwd = WORKDIR
): Result<string, SandboxError> => {
  const segments: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split(
    "/"
  )) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length === 0) {
        return err({ path, type: "invalid_path" });
      }
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return ok(`/${segments.join("/")}`);
};

const childrenOf = (
  files: Files,
  dir: string,
  recursive: boolean
): FileEntry[] => {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  const entries = new Map<string, FileEntry>();
  for (const [path, bytes] of files) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const [first, ...deeper] = rest.split("/");
    if (!first) {
      continue;
    }
    if (deeper.length === 0 || recursive) {
      entries.set(path, {
        modifiedAt: null,
        path,
        size: bytes.length,
        type: "file",
      });
    }
    if (deeper.length > 0) {
      const child = `${prefix}${first}`;
      entries.set(child, {
        modifiedAt: null,
        path: child,
        size: null,
        type: "directory",
      });
      if (recursive) {
        for (let depth = 1; depth < deeper.length; depth += 1) {
          const nested = `${child}/${deeper.slice(0, depth).join("/")}`;
          entries.set(nested, {
            modifiedAt: null,
            path: nested,
            size: null,
            type: "directory",
          });
        }
      }
    }
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
};

/** The root and workdir always exist; other directories exist while they hold files. */
const isDirectory = (files: Files, path: string) =>
  path === "/" ||
  path === WORKDIR ||
  [...files.keys()].some((file) => file.startsWith(`${path}/`));

const builtins: Record<string, FakeCommand> = {
  cat: (args, { cwd, files }) => {
    let stdout = "";
    for (const arg of args) {
      const path = resolvePath(arg, cwd);
      const bytes = path.ok ? files.get(path.value) : undefined;
      if (!bytes) {
        return {
          exitCode: 1,
          stderr: `cat: ${arg}: No such file or directory\n`,
          stdout,
        };
      }
      stdout += decode(bytes);
    }
    return { exitCode: 0, stdout };
  },
  echo: (args) => ({ exitCode: 0, stdout: `${args.join(" ")}\n` }),
  false: () => ({ exitCode: 1 }),
  ls: (args, { cwd, files }) => {
    const path = resolvePath(args.find((a) => !a.startsWith("-")) ?? ".", cwd);
    if (!(path.ok && isDirectory(files, path.value))) {
      return {
        exitCode: 2,
        stderr: "ls: cannot access: No such file or directory\n",
      };
    }
    const names = childrenOf(files, path.value, false).map((e) =>
      e.path.split("/").pop()
    );
    return {
      exitCode: 0,
      stdout: names.length > 0 ? `${names.join("\n")}\n` : "",
    };
  },
  // Directories exist implicitly (they hold files), so this only validates.
  mkdir: (args, { cwd }) =>
    args.every((arg) => arg.startsWith("-") || resolvePath(arg, cwd).ok)
      ? { exitCode: 0 }
      : { exitCode: 1, stderr: "mkdir: invalid path\n" },
  pwd: (_args, { cwd }) => ({ exitCode: 0, stdout: `${cwd}\n` }),
  rm: (args, { cwd, files }) => {
    for (const arg of args.filter((a) => !a.startsWith("-"))) {
      const path = resolvePath(arg, cwd);
      if (path.ok) {
        files.delete(path.value);
      }
    }
    return { exitCode: 0 };
  },
  true: () => ({ exitCode: 0 }),
};

/** Splits on whitespace, honouring simple single and double quotes. */
const tokenize = (command: string): string[] =>
  [...command.matchAll(TOKEN)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? ""
  );

export interface MemorySandboxOptions {
  readonly commands?: Readonly<Record<string, FakeCommand>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly id: SandboxId;
  readonly now?: () => Date;
  /** Where snapshots go; a factory shares one so `create` can restore them. */
  readonly snapshots?: Map<string, ReadonlyMap<string, Uint8Array>>;
}

export const createMemorySandbox = ({
  commands = {},
  files: initial = {},
  id,
  now = () => new Date(),
  snapshots = new Map(),
}: MemorySandboxOptions): Sandbox & {
  readonly files: () => ReadonlyMap<string, string>;
} => {
  const files: Files = new Map();
  for (const [path, content] of Object.entries(initial)) {
    const resolved = resolvePath(path);
    if (resolved.ok) {
      files.set(resolved.value, encode(content));
    }
  }
  let destroyed = false;
  const table = { ...builtins, ...commands };

  const alive = <T>(
    run: () => Result<T, SandboxError>
  ): Promise<Result<T, SandboxError>> =>
    Promise.resolve(destroyed ? err({ type: "destroyed" as const }) : run());

  const runOne = (segment: string, cwd: string) => {
    const redirect = REDIRECT.exec(segment);
    const [name = "", ...args] = tokenize(
      redirect ? (redirect[1] ?? "") : segment
    );
    const command = table[name];
    const result = command
      ? command(args, { cwd, files })
      : { exitCode: 127, stderr: `${name}: command not found\n` };
    if (!(redirect && result.exitCode === 0)) {
      return result;
    }
    const target = resolvePath(redirect[3] ?? "", cwd);
    if (!target.ok) {
      return { exitCode: 1, stderr: "invalid redirect target\n" };
    }
    const previous =
      redirect[2] === ">>"
        ? decode(files.get(target.value) ?? new Uint8Array())
        : "";
    files.set(target.value, encode(previous + (result.stdout ?? "")));
    return { ...result, stdout: "" };
  };

  /** Runs `a && b && c`, stopping at the first non-zero exit. */
  const runChain = (
    command: string,
    cwd: string,
    onOutput: ExecOptions["onOutput"]
  ) => {
    const output = { exitCode: 0, stderr: "", stdout: "" };
    for (const segment of command.split("&&").map((s) => s.trim())) {
      const { exitCode, stderr = "", stdout = "" } = runOne(segment, cwd);
      output.stdout += stdout;
      output.stderr += stderr;
      if (stdout) {
        onOutput?.({ data: stdout, stream: "stdout" });
      }
      if (stderr) {
        onOutput?.({ data: stderr, stream: "stderr" });
      }
      output.exitCode = exitCode;
      if (exitCode !== 0) {
        break;
      }
    }
    return output;
  };

  return {
    destroy: () => {
      destroyed = true;
      files.clear();
      return Promise.resolve(ok(undefined));
    },

    exec: (command: string, options: ExecOptions = {}) =>
      alive(() => {
        const started = now().getTime();
        const cwd = resolvePath(options.cwd ?? WORKDIR);
        if (!cwd.ok) {
          return cwd;
        }
        const { exitCode, stderr, stdout } = runChain(
          command,
          cwd.value,
          options.onOutput
        );
        const result: ExecResult = {
          durationMs: now().getTime() - started,
          exitCode,
          stderr,
          stdout,
          timedOut: false,
          truncated: false,
        };
        return ok(result);
      }),

    exposePort: (port) =>
      alive(() => {
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          return err({
            message: `port ${port} is out of range`,
            type: "limit_exceeded" as const,
          });
        }
        return ok({ port, url: `https://${id}-${port}.sandbox.test` });
      }),

    files: () =>
      new Map([...files].map(([path, bytes]) => [path, decode(bytes)])),

    id,

    listFiles: (path, options = {}) =>
      alive(() => {
        const resolved = resolvePath(path);
        if (!resolved.ok) {
          return resolved;
        }
        if (!isDirectory(files, resolved.value)) {
          return err({ path, type: "not_found" as const });
        }
        return ok(
          childrenOf(files, resolved.value, options.recursive ?? false)
        );
      }),

    provider: "just-bash",

    readFile: (path) =>
      alive(() => {
        const resolved = resolvePath(path);
        if (!resolved.ok) {
          return resolved;
        }
        const bytes = files.get(resolved.value);
        return bytes
          ? ok(bytes.slice())
          : err({ path, type: "not_found" as const });
      }),

    snapshot: () =>
      alive(() => {
        const ref = `${id}-snapshot-${snapshots.size + 1}`;
        snapshots.set(ref, new Map(files));
        return ok({ ref });
      }),

    status: () => alive(() => ok({ state: "ready" as const })),

    writeFile: (path, content) =>
      alive(() => {
        const resolved = resolvePath(path);
        if (!resolved.ok) {
          return resolved;
        }
        files.set(
          resolved.value,
          typeof content === "string" ? encode(content) : content.slice()
        );
        return ok(undefined);
      }),
  };
};

/** A factory over memory sandboxes; `create` with `snapshotRef` restores its files. */
export const createMemorySandboxFactory = (
  options: Pick<MemorySandboxOptions, "commands" | "now"> = {}
): SandboxFactory => {
  const live = new Map<SandboxId, Sandbox>();
  // Snapshots outlive the sandbox that took them, like a provider's store.
  const snapshots = new Map<string, ReadonlyMap<string, Uint8Array>>();
  return {
    attach: (id) => {
      const sandbox = live.get(id);
      return Promise.resolve(
        sandbox
          ? ok(sandbox)
          : err({ message: `no sandbox ${id}`, type: "unavailable" as const })
      );
    },
    create: (spec: CreateSandboxSpec) => {
      const snapshot = spec.snapshotRef
        ? snapshots.get(spec.snapshotRef)
        : undefined;
      if (spec.snapshotRef && !snapshot) {
        return Promise.resolve(
          err({ path: spec.snapshotRef, type: "not_found" as const })
        );
      }
      const sandbox = createMemorySandbox({
        ...options,
        files: Object.fromEntries(
          [...(snapshot ?? [])].map(([path, bytes]) => [path, decode(bytes)])
        ),
        id: spec.id,
        snapshots,
      });
      live.set(spec.id, sandbox);
      return Promise.resolve(ok(sandbox));
    },
    provider: "just-bash",
  };
};
