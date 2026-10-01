import {
  artifactIdSchema,
  artifactVersionIdSchema,
} from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";
import { z } from "zod";

import type { Turn } from "./turn";

// Plan mode (106): a run with `options.mode: "plan"` investigates and
// answers with a plan; it never changes anything. This is the narrow
// built-in read-only rule; the permissions proposal (073) will make it a
// preset where everything that writes is `deny`.
//
// The rule is enforced here, on the server, on the tool set the agent loop
// gets (the executor applies `planTurn` to every pass, after every wrapper
// has added its tools), not in the client and not only in the prompt:
// - a tool that isn't known to be read-only is left out, so the model never
//   sees it, and a call to it is a call to no tool: the loop runs nothing
//   and answers it with a tool error saying it isn't available while
//   planning, which the model reads before it goes on (131);
// - `bash` stays, but checks each command against a short list of read-only
//   programs before the sandbox runs it, and hands the sandbox the words it
//   checked, quoted, so the shell can't read them any other way.

/**
 * Built-in tools a planning run keeps: they read and search, nothing else.
 * `load_skill` (127) only reads a skill the turn was given.
 */
export const PLAN_READ_TOOLS = [
  "read",
  "file_search",
  "web_search",
  "load_skill",
] as const;

const BASH = "bash";

/** MCP tools are named `server__tool` (`@workspace/mcp`'s tool names); built-ins never are. */
const MCP_SEPARATOR = "__";

/** What a refused command's tool error starts with. */
export const PLAN_REFUSED = "Plan mode only runs read-only commands";

/** Longest command a planning run will check; real reads are short. */
const MAX_COMMAND = 4000;

/** Programs a planning run may start, and nothing they can be told to run. */
const READ_ONLY_PROGRAMS = new Set([
  "cat",
  "find",
  "git",
  "grep",
  "head",
  "ls",
  "rg",
  "tail",
  "wc",
]);

const GIT_SUBCOMMANDS = new Set(["diff", "log", "show", "status"]);

/**
 * Characters a word may have outside quotes. Everything the shell treats
 * specially (`;&|<>()$\`\\*?[]{}!#`, whitespace other than a space or tab,
 * newlines) is missing, so it's refused rather than interpreted. `~` is
 * allowed inside a word (`HEAD~1`), where bash leaves it alone, but not
 * starting one.
 */
const PLAIN = /^[A-Za-z0-9_./:=@%+,^-]$/;
const TILDE = "~";
/** A whole word that needs no quotes when it's handed back. */
const PLAIN_WORD = /^[A-Za-z0-9_./:=@%+,^-]+$/;
/** Special inside double quotes, so refused there; single quotes keep everything literal. */
const DOUBLE_QUOTED_SPECIAL = /[$`\\!]/;
const LINE_BREAK = /[\n\r\0]/;

/** `find` actions that delete, run a program, or write a file. */
const FIND_WRITES =
  /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
/** `rg` options that run another program. */
const RG_RUNS = /^--(?:pre|pre-glob|hostname-bin)(?:=|$)/;
/**
 * `git` options that write a file (`--output`, which git lets you shorten
 * to `--ou…`) or run a configured program (`--ext-diff`, `--textconv`).
 */
const GIT_WRITES = /^--(?:ou|ext|textc)/;

type Words = Result<readonly string[], string>;

const describeChar = (char: string): string =>
  char === "\n" || char === "\r" ? "a line break" : `\`${char}\``;

/** Ends a quoted run: its text, and where reading goes on. */
const quoted = (
  command: string,
  start: number,
  quote: "'" | '"'
): Result<{ readonly next: number; readonly text: string }, string> => {
  const end = command.indexOf(quote, start + 1);
  if (end < 0) {
    return err("an unclosed quote");
  }
  const text = command.slice(start + 1, end);
  if (LINE_BREAK.test(text)) {
    return err("a line break");
  }
  if (quote === '"' && DOUBLE_QUOTED_SPECIAL.test(text)) {
    return err("`$`, a backtick, a backslash or `!` inside double quotes");
  }
  return ok({ next: end + 1, text });
};

/**
 * The command as words, the way bash would split it if it held nothing but
 * plain words and quotes; anything else is refused with what it was. Pure.
 */
const words = (command: string): Words => {
  const out: string[] = [];
  let word = "";
  let inWord = false;
  let at = 0;
  while (at < command.length) {
    const char = command.charAt(at);
    if (char === " " || char === "\t") {
      if (inWord) {
        out.push(word);
        word = "";
        inWord = false;
      }
      at += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const run = quoted(command, at, char);
      if (!run.ok) {
        return run;
      }
      word += run.value.text;
      inWord = true;
      at = run.value.next;
      continue;
    }
    const midWord = char === TILDE && inWord;
    if (!(PLAIN.test(char) || midWord)) {
      return err(describeChar(char));
    }
    word += char;
    inWord = true;
    at += 1;
  }
  if (inWord) {
    out.push(word);
  }
  return ok(out);
};

/** A word bash reads back as exactly itself. */
const shellWord = (word: string): string =>
  PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

const refusedArgument = (
  program: string,
  args: readonly string[]
): string | undefined => {
  switch (program) {
    case "find":
      return args.find((arg) => FIND_WRITES.test(arg));
    case "rg":
      return args.find((arg) => RG_RUNS.test(arg));
    case "git":
      return args.find((arg) => GIT_WRITES.test(arg));
    default:
      return;
  }
};

/** git, made unable to page, take locks, or start a configured program. */
const hardenedGit = (args: readonly string[]): readonly string[] => {
  const [subcommand = "", ...rest] = args;
  return [
    "git",
    "--no-pager",
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    subcommand,
    ...(subcommand === "status" ? [] : ["--no-ext-diff", "--no-textconv"]),
    ...rest,
  ];
};

/**
 * Whether a planning run may run `command` in its sandbox: one read-only
 * program (`ls`, `cat`, `head`, `tail`, `wc`, `rg`, `grep`, `find` without
 * its writing actions, `git status|log|diff|show`) with plain or quoted
 * arguments, and nothing that chains, pipes, redirects, substitutes or
 * expands. On success, the command to run: the same words, quoted so bash
 * reads exactly them. On refusal, what was wrong, for the tool error. Pure.
 */
export const checkPlanCommand = (command: string): Result<string, string> => {
  if (command.length > MAX_COMMAND) {
    return err("a command longer than 4000 characters");
  }
  const split = words(command);
  if (!split.ok) {
    return err(split.error);
  }
  const [program, ...args] = split.value;
  if (program === undefined) {
    return err("an empty command");
  }
  if (!READ_ONLY_PROGRAMS.has(program)) {
    return err(`\`${program}\`, which isn't a read-only command`);
  }
  if (program === "git" && !GIT_SUBCOMMANDS.has(args[0] ?? "")) {
    return err("a git command other than status, log, diff or show");
  }
  const refused = refusedArgument(program, args);
  if (refused !== undefined) {
    return err(`\`${program} ${refused}\`, which can write or run a program`);
  }
  const checked = program === "git" ? hardenedGit(args) : split.value;
  return ok(checked.map(shellWord).join(" "));
};

const refusal = (reason: string) => ({
  message: `${PLAN_REFUSED} (ls, cat, head, tail, wc, rg, grep, find, git status|log|diff|show), one at a time without pipes, redirects, chaining or substitution. Refused: ${reason}.`,
  status: "error" as const,
});

const bashInputSchema = z.looseObject({ command: z.string() });

/** `bash` that runs only what `checkPlanCommand` allows, as it checked it. */
const readOnlyBash = (bash: Tool): Tool | null => {
  const { execute } = bash;
  // A client's bash (no `execute`) runs where nothing here can check it.
  if (!execute) {
    return null;
  }
  return {
    ...bash,
    execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
      const parsed = bashInputSchema.safeParse(input);
      if (!parsed.success) {
        return refusal("input without a command");
      }
      const checked = checkPlanCommand(parsed.data.command);
      if (!checked.ok) {
        return refusal(checked.error);
      }
      return execute({ ...parsed.data, command: checked.value }, options);
    },
  } as Tool;
};

const annotationsSchema = z.looseObject({
  annotations: z.looseObject({
    destructiveHint: z.boolean().optional(),
    readOnlyHint: z.boolean().optional(),
  }),
});

/**
 * An MCP tool its server marks read-only (`readOnlyHint`, which
 * `@ai-sdk/mcp` keeps in the tool's metadata) and not also destructive.
 * Unmarked tools are left out: nobody said they only read.
 */
const isReadOnlyMcp = (name: string, candidate: Tool): boolean => {
  if (!name.includes(MCP_SEPARATOR)) {
    return false;
  }
  const parsed = annotationsSchema.safeParse(
    (candidate as { readonly metadata?: unknown }).metadata
  );
  return (
    parsed.success &&
    parsed.data.annotations.readOnlyHint === true &&
    parsed.data.annotations.destructiveHint !== true
  );
};

const planTool = (name: string, candidate: Tool): Tool | null => {
  if (name === BASH) {
    return readOnlyBash(candidate);
  }
  if ((PLAN_READ_TOOLS as readonly string[]).includes(name)) {
    return candidate;
  }
  return isReadOnlyMcp(name, candidate) ? candidate : null;
};

type PlannedTurn = Pick<
  Turn,
  "proposeEdits" | "toolApproval" | "tools" | "unavailableTools"
>;

/** What the model reads when it calls a tool a planning run left out. */
export const planUnavailable = (name: string): string =>
  `\`${name}\` isn't available while planning. Plan mode only reads; finish the plan, and the change can be made once it's approved.`;

/**
 * A turn as a planning run gets it: only the tools that read, `bash` held
 * to read-only commands, every approval as it was (planning makes nothing
 * automatic), and no edits to propose. Everything else is left out, so the
 * model never sees it, and named in `unavailableTools`, so a call to it
 * comes back as a tool error saying why, and the run goes on. Pure.
 */
export const planTurn = <T extends PlannedTurn>(turn: T): T & PlannedTurn => {
  if (!turn.tools) {
    return { ...turn, proposeEdits: undefined };
  }
  const tools: ToolSet = {};
  const toolApproval: Record<string, ToolApprovalStatus> = {};
  const unavailableTools: Record<string, string> = {};
  for (const [name, each] of Object.entries(turn.tools)) {
    const kept = planTool(name, each);
    if (!kept) {
      unavailableTools[name] = planUnavailable(name);
      continue;
    }
    tools[name] = kept;
    const approval = turn.toolApproval?.[name];
    if (approval) {
      toolApproval[name] = approval;
    }
  }
  return {
    ...turn,
    proposeEdits: undefined,
    toolApproval,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    unavailableTools,
  };
};

// The plan, once written: saved as a markdown artifact and pointed at from
// the answer by a `plan` data part, which the chat shows as the plan card.
// Approving it sends a `plan-approval` data part with the next message; the
// server reads the version it names into that run's instructions.

/** The answer's data part naming its saved plan. */
export const PLAN_DATA = "plan";
/** The approving message's data part. */
export const PLAN_APPROVAL_DATA = "plan-approval";

/** Longest plan a person may send back edited. */
export const PLAN_MAX_CHARS = 100_000;

const TITLE_MAX = 200;
const TITLE_PREFIX = "Plan: ";
const HEADING = /^#\s+(.+?)\s*#*\s*$/m;

export const planRefSchema = z.object({
  artifactId: artifactIdSchema,
  title: z.string().max(TITLE_MAX),
  versionId: artifactVersionIdSchema,
});
export type PlanRef = z.infer<typeof planRefSchema>;

export const planApprovalSchema = z.object({
  artifactId: artifactIdSchema,
  /** The plan as the person edited it; saved as a new version before the run. */
  content: z.string().min(1).max(PLAN_MAX_CHARS).optional(),
  /** Set by the server when the message is placed: the version approved. */
  versionId: artifactVersionIdSchema.optional(),
});
export type PlanApproval = z.infer<typeof planApprovalSchema>;

/**
 * The plan artifact's title: "Plan: " and the plan's first `#` heading, or
 * the request it answers when it has none. Pure.
 */
export const planTitle = (plan: string, request: string): string => {
  const heading = HEADING.exec(plan)?.[1]?.trim();
  const name = (heading ?? request.split("\n")[0] ?? "").trim();
  if (name === "") {
    return "Plan";
  }
  const titled = name.toLowerCase().startsWith("plan:")
    ? name
    : `${TITLE_PREFIX}${name}`;
  return titled.length > TITLE_MAX
    ? `${titled.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : titled;
};

/** The answer's prose: what the plan artifact holds. Pure. */
export const planText = (parts: readonly MessagePart[]): string =>
  parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();

/** The approval a message's parts carry, if any. Pure. */
export const planApprovalOf = (
  parts: readonly MessagePart[]
): PlanApproval | null => {
  for (const part of parts) {
    if (part.type === "data" && part.name === PLAN_APPROVAL_DATA) {
      const parsed = planApprovalSchema.safeParse(part.data);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return null;
};
