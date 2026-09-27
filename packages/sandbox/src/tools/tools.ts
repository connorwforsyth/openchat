import { applyReview } from "@workspace/code-ui/review/apply";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import {
  type ProposedEdit,
  proposedEditSchema,
} from "@workspace/contract/schemas/runs";
import {
  execResultSchema,
  sandboxPathSchema,
  sandboxPreviewSchema,
} from "@workspace/contract/schemas/sandbox";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { type Tool, tool } from "ai";
import { z } from "zod";

import type { OutputChunk, Sandbox, SandboxError } from "../ports/sandbox";
import { proposeEdit } from "./patch";

// The agent's sandbox tools (D7) over any `Sandbox`: `bash`, `read`, `write`,
// `edit` and `preview`. `write` and `edit` never touch the file blindly:
// each computes a `ProposedEdit` first, and in `ask` mode the run executor
// shows it for per-hunk review (D16) and hands the decision back through
// `reviewFor`; only accepted hunks are applied. Expected failures come back
// as `{ status: "error" }` outputs the model can read, not throws.

export const SANDBOX_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "preview",
] as const;
export type SandboxToolName = (typeof SANDBOX_TOOL_NAMES)[number];

/** Largest file `read` returns whole; bigger ones need `offset`/`limit`. */
const MAX_READ_CHARS = 200_000;

export const bashInputSchema = z.object({
  command: z.string().min(1).max(100_000).describe("The command to run"),
  cwd: sandboxPathSchema
    .optional()
    .describe("Working directory; defaults to the workspace root"),
  timeoutMs: z
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .describe("Kill the command after this long"),
});

export const readInputSchema = z.object({
  limit: z.int().min(1).max(10_000).optional().describe("Lines to return"),
  offset: z.int().min(1).optional().describe("1-based line to start at"),
  path: sandboxPathSchema,
});

export const writeInputSchema = z.object({
  content: z.string().max(5_000_000),
  path: sandboxPathSchema,
});

export const editInputSchema = z.object({
  newString: z.string().max(1_000_000),
  oldString: z
    .string()
    .min(1)
    .max(1_000_000)
    .describe("Exact text to replace; must be unique unless replaceAll"),
  path: sandboxPathSchema,
  replaceAll: z.boolean().optional(),
});

export const previewInputSchema = z.object({
  port: z.int().min(1).max(65_535).describe("The port a server listens on"),
});

const toolErrorSchema = z.object({
  message: z.string(),
  status: z.literal("error"),
});

/** What `write` and `edit` return: the proposal and which hunks landed. */
export const fileChangeOutputSchema = z.discriminatedUnion("status", [
  z.object({ path: z.string(), status: z.literal("unchanged") }),
  z.object({
    applied: z.array(z.string()),
    edit: proposedEditSchema,
    /** The reviewer's comments (rejected hunks, lines), for the agent to act on (D16). */
    feedback: z.string().optional(),
    /** Rejected or undecided hunks; the file keeps their original lines. */
    rejected: z.array(z.string()),
    status: z.literal("changed"),
  }),
  toolErrorSchema,
]);
export type FileChangeOutput = z.infer<typeof fileChangeOutputSchema>;

export const bashOutputSchema = z.union([
  execResultSchema.extend({ status: z.literal("ran") }),
  toolErrorSchema,
]);
export const readOutputSchema = z.union([
  z.object({
    content: z.string(),
    path: z.string(),
    status: z.literal("read"),
    totalLines: z.int().min(0),
    truncated: z.boolean(),
  }),
  toolErrorSchema,
]);
export const previewOutputSchema = z.union([
  sandboxPreviewSchema.extend({ status: z.literal("exposed") }),
  toolErrorSchema,
]);

/** A decision on a write/edit call, with the proposal the reviewer saw. */
export interface Review {
  readonly decision: ApprovalDecision;
  /** When given, the file must still produce this exact patch. */
  readonly proposed?: ProposedEdit;
}

/** Looks up the review of a call; `undefined` means it ran without one. */
export type ReviewLookup = (
  toolCallId: string
) => Review | undefined | Promise<Review | undefined>;

/** The part of a `Sandbox` the tools use; a lazily started sandbox can stand in. */
export type ToolSandbox = Pick<
  Sandbox,
  "exec" | "exposePort" | "readFile" | "writeFile"
>;

export interface SandboxToolsOptions {
  /** Streams `bash` output to the panel as it arrives. */
  readonly onOutput?: (toolCallId: string, chunk: OutputChunk) => void;
  readonly reviewFor?: ReviewLookup;
  readonly sandbox: ToolSandbox;
}

const describeError = (error: SandboxError): string => {
  switch (error.type) {
    case "not_found":
      return `${error.path}: no such file or directory`;
    case "invalid_path":
      return `${error.path}: path is outside the sandbox`;
    case "destroyed":
      return "The sandbox was destroyed; ask the user to create a new one.";
    case "unsupported":
      return error.operation === "exposePort"
        ? "This sandbox can't serve previews; previews need a Docker sandbox."
        : `This sandbox doesn't support ${error.operation}.`;
    case "limit_exceeded":
      return `Sandbox limit reached: ${error.message}`;
    case "unavailable":
      return `The sandbox is unavailable: ${error.message}`;
    default:
      return error satisfies never;
  }
};

const failure = (message: string) => ({ message, status: "error" as const });

const decoder = new TextDecoder("utf-8", { fatal: true });

/** A file as text: missing is empty (for `write`), binary is an error. */
const readText = async (
  sandbox: ToolSandbox,
  path: string,
  { missingIsEmpty }: { readonly missingIsEmpty: boolean }
): AsyncResult<string, string> => {
  const read = await sandbox.readFile(path);
  if (!read.ok) {
    return missingIsEmpty && read.error.type === "not_found"
      ? ok("")
      : err(describeError(read.error));
  }
  try {
    return ok(decoder.decode(read.value));
  } catch {
    return err(`${path} is not a UTF-8 text file`);
  }
};

type ChangeInput =
  | { readonly input: z.infer<typeof writeInputSchema>; readonly kind: "write" }
  | { readonly input: z.infer<typeof editInputSchema>; readonly kind: "edit" };

const countOccurrences = (text: string, search: string): number =>
  text.split(search).length - 1;

/** The file before and after a write or edit, without writing anything. */
const planChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput
): AsyncResult<{ after: string; before: string; path: string }, string> => {
  const { path } = change.input;
  const before = await readText(sandbox, path, {
    missingIsEmpty: change.kind === "write",
  });
  if (!before.ok) {
    return before;
  }
  if (change.kind === "write") {
    return ok({ after: change.input.content, before: before.value, path });
  }
  const { newString, oldString, replaceAll } = change.input;
  const count = countOccurrences(before.value, oldString);
  if (count === 0) {
    return err(`oldString was not found in ${path}`);
  }
  if (count > 1 && !replaceAll) {
    return err(
      `oldString appears ${count} times in ${path}; add context to make it unique or set replaceAll`
    );
  }
  const after = replaceAll
    ? before.value.split(oldString).join(newString)
    : before.value.replace(oldString, () => newString);
  return ok({ after, before: before.value, path });
};

/**
 * What a `write` or `edit` call would change, for the approval request the
 * run executor shows before asking (`PendingApproval.edits`).
 */
export const proposeSandboxChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput
): AsyncResult<ReturnType<typeof proposeEdit>, string> => {
  const planned = await planChange(sandbox, change);
  return planned.ok
    ? ok(
        proposeEdit(
          planned.value.path,
          planned.value.before,
          planned.value.after
        )
      )
    : planned;
};

/** Which hunk ids a decision lets through. */
const acceptedHunks = (
  hunkIds: readonly string[],
  decision: ApprovalDecision | undefined
): ReadonlySet<string> => {
  if (decision === undefined) {
    return new Set(hunkIds);
  }
  switch (decision.decision) {
    case "approve":
      return new Set(hunkIds);
    case "reject":
      return new Set();
    case "review":
      return new Set(
        decision.hunks
          .filter((hunk) => hunk.decision === "accept")
          .map((hunk) => hunk.hunkId)
      );
    default:
      return decision satisfies never;
  }
};

/**
 * What the reviewer said beyond accept/reject: comments on rejected (or
 * accepted) hunks and on lines. The SDK only passes a reason along with a
 * denial, so a partly applied change carries it in its own result.
 */
export const reviewFeedback = (
  decision: ApprovalDecision | undefined
): string | undefined => {
  if (decision?.decision !== "review") {
    return;
  }
  const lines = [
    ...decision.hunks.flatMap((hunk) =>
      hunk.comment
        ? [
            `Hunk ${hunk.hunkId} (${hunk.decision === "accept" ? "accepted" : "rejected"}): ${hunk.comment}`,
          ]
        : []
    ),
    ...decision.comments.map(
      (comment) => `${comment.path}:${comment.line}: ${comment.text}`
    ),
  ];
  return lines.length > 0 ? lines.join("\n") : undefined;
};

/** Applies a write or edit, honouring a per-hunk review. */
export const applySandboxChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput,
  review: Review | undefined
): Promise<FileChangeOutput> => {
  const planned = await planChange(sandbox, change);
  if (!planned.ok) {
    return failure(planned.error);
  }
  const { after, before, path } = planned.value;
  const edit = proposeEdit(path, before, after);
  const stale = failure(
    `${path} changed since the edit was reviewed; read it again and retry`
  );
  if (review?.proposed && review.proposed.patch !== edit?.patch) {
    return stale;
  }
  if (edit === null) {
    return { path, status: "unchanged" };
  }
  const ids = edit.hunks.map((hunk) => hunk.hunkId);
  const accepted = acceptedHunks(ids, review?.decision);
  const applied = ids.filter((id) => accepted.has(id));
  const rejected = ids.filter((id) => !accepted.has(id));

  let next: Result<string, unknown> = ok(after);
  if (rejected.length > 0) {
    next = applyReview(
      before,
      edit,
      applied.map((hunkId) => ({ decision: "accept" as const, hunkId }))
    );
  }
  if (!next.ok) {
    return stale;
  }
  if (applied.length > 0) {
    const written = await sandbox.writeFile(path, next.value);
    if (!written.ok) {
      return failure(describeError(written.error));
    }
  }
  const feedback = reviewFeedback(review?.decision);
  return {
    applied,
    edit,
    ...(feedback ? { feedback } : {}),
    rejected,
    status: "changed",
  };
};

const sliceLines = (
  text: string,
  offset: number | undefined,
  limit: number | undefined
) => {
  const lines = text.split("\n");
  const start = (offset ?? 1) - 1;
  const end = limit === undefined ? lines.length : start + limit;
  return { content: lines.slice(start, end).join("\n"), total: lines.length };
};

export const createSandboxTools = ({
  onOutput,
  reviewFor,
  sandbox,
}: SandboxToolsOptions): Record<SandboxToolName, Tool> => ({
  bash: tool({
    description:
      "Run a bash command in the chat's sandbox. The working directory is the workspace root; files persist between calls.",
    execute: async (
      { command, cwd, timeoutMs },
      { abortSignal, toolCallId }
    ) => {
      const result = await sandbox.exec(command, {
        cwd,
        onOutput: onOutput ? (chunk) => onOutput(toolCallId, chunk) : undefined,
        signal: abortSignal,
        timeoutMs,
      });
      return result.ok
        ? { ...result.value, status: "ran" as const }
        : failure(describeError(result.error));
    },
    inputSchema: bashInputSchema,
    outputSchema: bashOutputSchema,
  }),

  edit: tool({
    description:
      "Replace an exact string in a text file in the sandbox. The change is shown to the user as a diff and may be applied only in part.",
    execute: async (input, { toolCallId }) =>
      applySandboxChange(
        sandbox,
        { input, kind: "edit" },
        await reviewFor?.(toolCallId)
      ),
    inputSchema: editInputSchema,
    outputSchema: fileChangeOutputSchema,
  }),

  preview: tool({
    description:
      "Expose a port a server in the sandbox listens on and get a URL the user can open in the preview panel.",
    execute: async ({ port }) => {
      const exposed = await sandbox.exposePort(port);
      return exposed.ok
        ? { ...exposed.value, status: "exposed" as const }
        : failure(describeError(exposed.error));
    },
    inputSchema: previewInputSchema,
    outputSchema: previewOutputSchema,
  }),

  read: tool({
    description:
      "Read a text file from the sandbox, optionally a range of lines.",
    execute: async ({ limit, offset, path }) => {
      const text = await readText(sandbox, path, { missingIsEmpty: false });
      if (!text.ok) {
        return failure(text.error);
      }
      const { content, total } = sliceLines(text.value, offset, limit);
      const truncated = content.length > MAX_READ_CHARS;
      return {
        content: truncated ? content.slice(0, MAX_READ_CHARS) : content,
        path,
        status: "read" as const,
        totalLines: total,
        truncated,
      };
    },
    inputSchema: readInputSchema,
    outputSchema: readOutputSchema,
  }),

  write: tool({
    description:
      "Create or overwrite a text file in the sandbox. The change is shown to the user as a diff and may be applied only in part.",
    execute: async (input, { toolCallId }) =>
      applySandboxChange(
        sandbox,
        { input, kind: "write" },
        await reviewFor?.(toolCallId)
      ),
    inputSchema: writeInputSchema,
    outputSchema: fileChangeOutputSchema,
  }),
});
