// The port a server in this checkout listens on, so parallel worktrees on one
// machine stop fighting over 3000, 3100 and 3184 (ticket 140).
//
//   bun ../../scripts/ci/dev-port.ts 3000 PORT next dev
//
// The main checkout keeps the base port. A linked worktree adds an offset
// hashed from its path: stable across restarts, distinct from its siblings,
// and never one of the main checkout's ports. An explicit variable (`PORT`,
// `E2E_PORT`, `EVALS_PORT`) always wins. Callers print the result, because an
// agent in a worktree has to read its port rather than assume it.
//
// Run as a command it resolves the port, prints it on one line, and runs the
// rest of the line with the variable set (Next reads `PORT`).
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

/** The repository root this file sits in: the checkout whose port it is. */
export const CHECKOUT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.."
);

// Worktree offsets start past every base's main-checkout port (3000, 3100,
// 3184, 3190) and stay low enough that base + offset is far below 65535 and
// clear of the ephemeral range the mocks' OS-assigned ports come from.
const MIN_OFFSET = 1000;
const OFFSET_SPAN = 2000;

// Ports a worktree's port steps past: those browsers refuse to fetch (the
// Fetch spec's "bad ports") and ones something on a developer's machine
// usually holds already (macOS AirPlay, Vite, Postgres).
const AVOIDED_PORTS: ReadonlySet<number> = new Set([
  4045, 4190, 5000, 5060, 5061, 5173, 5432, 6000,
]);

const LINE_BREAK = /\r?\n/;
const SEPARATORS = /[/\\]+/;
const TRAILING_SEPARATORS = /[/\\]+$/;

export const PortSchema = z.coerce.number().int().min(1).max(65_535);

export const CheckoutSchema = z.object({
  /** Whether this is a linked worktree rather than the main checkout. */
  linked: z.boolean(),
  /** The checkout's absolute path. */
  path: z.string(),
});
export type Checkout = z.infer<typeof CheckoutSchema>;

export const PortResolutionSchema = z.object({
  port: PortSchema,
  /** Where the port came from, for the line the caller prints. */
  source: z.string(),
});
export type PortResolution = z.infer<typeof PortResolutionSchema>;

/** The shape of `@workspace/shared`'s `Result`, which scripts can't import. */
export type PortResult =
  | { readonly ok: true; readonly value: PortResolution }
  | { readonly error: string; readonly ok: false };

/**
 * Whether a `.git` file's contents mark a linked worktree. Git points a linked
 * worktree's `.git` at `<common-dir>/worktrees/<name>`; a submodule's points
 * at `<git-dir>/modules/<name>`, and the main checkout's `.git` is a directory
 * (pass `undefined`). The common dir isn't always named `.git` (a bare repo's
 * worktrees point into `<repo>.git`), so this matches the `worktrees/<name>`
 * tail as path segments, as T3 Code's `devHome.ts` does.
 */
export const isLinkedWorktree = (gitFile: string | undefined): boolean => {
  const gitdir = gitFile
    ?.split(LINE_BREAK)
    .map((line) => line.trim())
    .find((line) => line.startsWith("gitdir:"))
    ?.slice("gitdir:".length)
    .trim();
  if (!gitdir) {
    return false;
  }
  const segments = gitdir.split(SEPARATORS).filter(Boolean);
  return segments.length >= 3 && segments.at(-2) === "worktrees";
};

/** FNV-1a: small, stable across runtimes, and spreads similar paths apart. */
const hash = (text: string): number => {
  let value = 0x81_1c_9d_c5;
  for (const char of text) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is bitwise by definition
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: reads the hash as unsigned
  return value >>> 0;
};

/** 0 for the main checkout; for a linked worktree, a hash of its path. */
export const offsetFor = (checkout: Checkout): number => {
  if (!checkout.linked) {
    return 0;
  }
  // A trailing separator must not move the port.
  const path = checkout.path.replace(TRAILING_SEPARATORS, "");
  return MIN_OFFSET + (hash(path) % OFFSET_SPAN);
};

/** The port a server with this base port uses in this checkout. */
export const portFor = (base: number, checkout: Checkout): number => {
  let port = base + offsetFor(checkout);
  if (port === base) {
    return port;
  }
  while (AVOIDED_PORTS.has(port)) {
    port += 1;
  }
  return port;
};

/** The explicit variable if it's set, otherwise this checkout's port. */
export const resolvePort = (input: {
  readonly base: number;
  readonly checkout: Checkout;
  /** The variable's name, for the source and the error. */
  readonly envName: string;
  /** The variable's value, if any. */
  readonly explicit: string | undefined;
}): PortResult => {
  const explicit = input.explicit?.trim();
  if (explicit) {
    const parsed = PortSchema.safeParse(explicit);
    return parsed.success
      ? { ok: true, value: { port: parsed.data, source: input.envName } }
      : {
          error: `${input.envName}=${explicit} is not a port (1 to 65535)`,
          ok: false,
        };
  }
  const port = portFor(input.base, input.checkout);
  return {
    ok: true,
    value: {
      port,
      source: input.checkout.linked
        ? `this worktree; set ${input.envName} to choose`
        : "main checkout",
    },
  };
};

/** Reads whether `root` is a linked worktree from its `.git`. */
export const readCheckout = (root = CHECKOUT_ROOT): Checkout => {
  const gitPath = resolve(root, ".git");
  let gitFile: string | undefined;
  try {
    gitFile = statSync(gitPath).isFile()
      ? readFileSync(gitPath, "utf8")
      : undefined;
  } catch {
    // No `.git` (a Docker build context, an unpacked tarball): not a
    // worktree, so the base port.
    gitFile = undefined;
  }
  return { linked: isLinkedWorktree(gitFile), path: root };
};

/**
 * This checkout's port for `base`, with `envName` from the environment
 * winning. A malformed variable is a setup mistake to fix before anything
 * starts, so it throws, at config load or command start.
 */
export const devPort = (
  base: number,
  envName: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): PortResolution => {
  const result = resolvePort({
    base,
    checkout: readCheckout(),
    envName,
    explicit: env[envName],
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
};

/** The one line a caller prints, so an agent reads the port. */
export const portLine = (label: string, resolution: PortResolution): string =>
  `[${label}] http://localhost:${resolution.port} (${resolution.source})`;

const main = (): void => {
  const [base, envName, command, ...args] = process.argv.slice(2);
  const parsedBase = PortSchema.safeParse(base);
  if (!(parsedBase.success && envName && command)) {
    console.error(
      "usage: dev-port.ts <base port> <ENV_NAME> <command> [...args]"
    );
    process.exit(2);
  }
  const result = resolvePort({
    base: parsedBase.data,
    checkout: readCheckout(),
    envName,
    explicit: process.env[envName],
  });
  if (!result.ok) {
    console.error(result.error);
    process.exit(2);
  }
  console.log(portLine(command, result.value));

  const child = spawn(command, args, {
    env: { ...process.env, [envName]: String(result.value.port) },
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
};

if (import.meta.main) {
  main();
}
