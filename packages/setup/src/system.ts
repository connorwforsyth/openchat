// The ports the commands use to touch the machine: files, child processes,
// HTTP and TCP ports. `node-system.ts` has the real ones; the in-memory
// fakes here are what the tests run against, so no test starts Docker.

export interface Files {
  /** Reads a file under the repo root; `undefined` when it doesn't exist. */
  read: (path: string) => Promise<string | undefined>;
  /** `secret` files are readable by their owner only (`.env`). */
  write: (
    path: string,
    text: string,
    options?: { readonly secret?: boolean }
  ) => Promise<void>;
}

export interface CommandResult {
  readonly code: number;
  /** Captured stdout; empty when the command's output went to the terminal. */
  readonly stdout: string;
}

export interface Command {
  readonly args: readonly string[];
  readonly command: string;
  /** Added to this process's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Stream to the terminal (builds, `bun dev`) rather than capture. */
  readonly inherit?: boolean;
}

export interface Runner {
  /** Resolves with the exit code; a command that can't start is code 127. */
  run: (command: Command) => Promise<CommandResult>;
}

export interface HttpResponse {
  readonly status: number;
  text: () => Promise<string>;
}

/** GET only: the doctor reads, it never changes anything. */
export type HttpGet = (
  url: string,
  headers?: Readonly<Record<string, string>>
) => Promise<HttpResponse>;

/** Whether something is listening on this localhost port. */
export type PortInUse = (port: number) => Promise<boolean>;

export interface MemoryFiles extends Files {
  readonly files: Map<string, string>;
  /** Paths written with `secret`. */
  readonly secretPaths: Set<string>;
}

export const createMemoryFiles = (
  initial: Readonly<Record<string, string>> = {}
): MemoryFiles => {
  const files = new Map(Object.entries(initial));
  const secretPaths = new Set<string>();
  return {
    files,
    read: (path) => Promise.resolve(files.get(path)),
    secretPaths,
    write: (path, text, options) => {
      files.set(path, text);
      if (options?.secret) {
        secretPaths.add(path);
      }
      return Promise.resolve();
    },
  };
};

export interface FakeRunner extends Runner {
  readonly calls: Command[];
}

/** Answers each command from `respond`, and records it. */
export const createFakeRunner = (
  respond: (command: Command) => Partial<CommandResult> = () => ({})
): FakeRunner => {
  const calls: Command[] = [];
  return {
    calls,
    run: (command) => {
      calls.push(command);
      return Promise.resolve({ code: 0, stdout: "", ...respond(command) });
    },
  };
};

/** `routes[url]` is a status and body; anything else fails like a closed port. */
export const createFakeHttp =
  (
    routes: Readonly<Record<string, { status: number; body?: string }>>
  ): HttpGet =>
  (url) => {
    const route = routes[url];
    if (!route) {
      return Promise.reject(new Error(`connect ECONNREFUSED ${url}`));
    }
    return Promise.resolve({
      status: route.status,
      text: () => Promise.resolve(route.body ?? ""),
    });
  };
