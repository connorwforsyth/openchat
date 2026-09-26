import type { ExecResult } from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

// The panel's terminal log as data: commands, their output and how they
// ended. Pure functions, so the panel just renders whatever this returns.
// Consecutive chunks of one stream merge into one entry (a build streams
// thousands), and the oldest entries go once the log passes its budget.

export const terminalEntrySchema = z.discriminatedUnion("kind", [
  z.object({ id: z.int(), kind: z.literal("command"), text: z.string() }),
  z.object({
    id: z.int(),
    kind: z.literal("output"),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
  }),
  z.object({
    durationMs: z.int().min(0),
    exitCode: z.int(),
    id: z.int(),
    kind: z.literal("exit"),
    timedOut: z.boolean(),
    truncated: z.boolean(),
  }),
  z.object({ id: z.int(), kind: z.literal("error"), message: z.string() }),
]);
export type TerminalEntry = z.infer<typeof terminalEntrySchema>;

export interface TerminalLog {
  readonly entries: readonly TerminalEntry[];
  readonly nextId: number;
}

/** Characters of output kept on screen; older entries scroll off for good. */
export const MAX_LOG_CHARS = 200_000;

export const emptyLog: TerminalLog = { entries: [], nextId: 1 };

const sizeOf = (entry: TerminalEntry): number => {
  switch (entry.kind) {
    case "command":
    case "output":
      return entry.text.length;
    case "error":
      return entry.message.length;
    case "exit":
      return 0;
    default:
      return entry satisfies never;
  }
};

/** Drops whole entries from the front until the log fits. */
const trim = (entries: readonly TerminalEntry[]): readonly TerminalEntry[] => {
  let total = entries.reduce((sum, entry) => sum + sizeOf(entry), 0);
  let start = 0;
  while (total > MAX_LOG_CHARS && start < entries.length - 1) {
    total -= sizeOf(entries[start] as TerminalEntry);
    start += 1;
  }
  return start === 0 ? entries : entries.slice(start);
};

type NewEntry = TerminalEntry extends infer E
  ? E extends TerminalEntry
    ? Omit<E, "id">
    : never
  : never;

const push = (log: TerminalLog, entry: NewEntry): TerminalLog => ({
  entries: trim([
    ...log.entries,
    { ...entry, id: log.nextId } as TerminalEntry,
  ]),
  nextId: log.nextId + 1,
});

export const appendCommand = (log: TerminalLog, text: string): TerminalLog =>
  push(log, { kind: "command", text });

export const appendOutput = (
  log: TerminalLog,
  stream: "stdout" | "stderr",
  text: string
): TerminalLog => {
  if (!text) {
    return log;
  }
  const last = log.entries.at(-1);
  if (last?.kind === "output" && last.stream === stream) {
    return {
      entries: trim([
        ...log.entries.slice(0, -1),
        { ...last, text: last.text + text },
      ]),
      nextId: log.nextId,
    };
  }
  return push(log, { kind: "output", stream, text });
};

/**
 * Records how a command ended. Output that wasn't streamed (a provider that
 * only answers at the end) is appended first, so nothing shows twice.
 */
export const appendExit = (
  log: TerminalLog,
  result: ExecResult,
  streamed: { readonly stderr: boolean; readonly stdout: boolean }
): TerminalLog => {
  let next = log;
  if (!streamed.stdout) {
    next = appendOutput(next, "stdout", result.stdout);
  }
  if (!streamed.stderr) {
    next = appendOutput(next, "stderr", result.stderr);
  }
  return push(next, {
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    kind: "exit",
    timedOut: result.timedOut,
    truncated: result.truncated,
  });
};

export const appendError = (log: TerminalLog, message: string): TerminalLog =>
  push(log, { kind: "error", message });
