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

import { WORKDIR } from "../paths";
import type { OutputChunk, Sandbox, SandboxError } from "../ports/sandbox";
import { STATIC_PREVIEW_PORT } from "../static-preview";
import { wait, waitForListener } from "./listener";
import { proposeEdit } from "./patch";

// The agent's sandbox tools (D7) over any `Sandbox`: `bash`, `read`, `write`,
// `edit` and `preview`. The user calls the sandbox the chat's workspace and
// sees its files in the Files panel, so the descriptions say so. `write`
// and `edit` never touch the file blindly: each computes a `ProposedEdit`
// first, and in `ask` mode the run executor shows it for per-hunk review
// (D16) and hands the decision back through `reviewFor`; only accepted
// hunks are applied. The proposal carries a hash of the file it was made
// from, so a file the user edited while the change waited isn't
// overwritten. Expected failures come back as `{ status: "error" }` outputs
// the model can read, not throws.

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
  /**
   * Called once a `write` or `edit` has landed (some of it applied), with
   * the path it was given; the static preview (067) hangs off it. It must
   * not fail: the change is already made.
   */
  readonly onChanged?: (path: string) => Promise<void>;
  /** Streams `bash` output to the panel as it arrives. */
  readonly onOutput?: (toolCallId: string, chunk: OutputChunk) => void;
  readonly reviewFor?: ReviewLookup;
  readonly sandbox: ToolSandbox;
  /** Waits between listener probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const describeError = (error: SandboxError): string => {
  switch (error.type) {
    case "not_found":
      return `${error.path}: no such file or directory`;
    case "invalid_path":
      return `${error.path}: path is outside the workspace`;
    case "destroyed":
      return "The workspace was reset and its files are gone; try again to use the new one.";
    case "unsupported":
      return error.operation === "exposePort"
        ? "This workspace can't serve previews; previews need a Docker workspace."
        : `This workspace doesn't support ${error.operation}.`;
    case "limit_exceeded":
      return `Workspace limit reached: ${error.message}`;
    case "unavailable":
      return `The workspace is unavailable: ${error.message}`;
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

const encoder = new TextEncoder();

/** SHA-256 of the file a change was planned against, as hex. */
export const contentHash = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const BASE_HASH = /^--- [^\n]*\tsha256:([0-9a-f]{64})$/m;
const OLD_HEADER = /^--- [^\n\t]*$/m;

/**
 * Stamps the patch's `---` header with the hash of the file it was made
 * from, where a unified diff keeps a timestamp. The proposal is stored with
 * the pending approval and handed back with the decision, and the contract
 * has no field for it; `DiffView` reads from the first hunk, so the header
 * is free.
 */
const withBaseHash = (edit: ProposedEdit, hash: string): ProposedEdit => ({
  ...edit,
  patch: edit.patch.replace(OLD_HEADER, (line) => `${line}\tsha256:${hash}`),
});

/** The hash a proposal was made from; `undefined` for one made before hashes. */
export const baseHashOf = (edit: ProposedEdit): string | undefined =>
  BASE_HASH.exec(edit.patch.slice(0, edit.patch.indexOf("\n@@")))?.[1];

/** The proposal for a planned change, stamped with its file's hash. */
const proposalFor = async (planned: {
  readonly after: string;
  readonly before: string;
  readonly path: string;
}): Promise<ProposedEdit | null> => {
  const edit = proposeEdit(planned.path, planned.before, planned.after);
  return edit && withBaseHash(edit, await contentHash(planned.before));
};

/**
 * What a `write` or `edit` call would change, for the approval request the
 * run executor shows before asking (`PendingApproval.edits`).
 */
export const proposeSandboxChange = async (
  sandbox: ToolSandbox,
  change: ChangeInput
): AsyncResult<ProposedEdit | null, string> => {
  const planned = await planChange(sandbox, change);
  return planned.ok ? ok(await proposalFor(planned.value)) : planned;
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
  // After an approval, the file must be the one the reviewer saw: the user
  // may have edited it in the Files panel while the change waited.
  const reviewedHash = review?.proposed && baseHashOf(review.proposed);
  if (reviewedHash && reviewedHash !== (await contentHash(before))) {
    return failure(
      `${path} was edited while this change waited for approval, so it wasn't applied. Read the file again and redo the change on its current contents.`
    );
  }
  const edit = await proposalFor(planned.value);
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

// `preview` checks that something listens on the port before exposing it:
// otherwise a model that built a library with no server still gets a URL,
// and the user a dead panel. If the socket tables can't be read (just-bash
// has no /proc), it doesn't block the preview.

const startServerHint = (port: number) =>
  `Start the dev server in the background bound to 0.0.0.0 (e.g. \`npm run dev -- --host 0.0.0.0 --port ${port} &\`) and call preview again.`;

/** Waits briefly for a listener on `port`; `ok` means expose it. */
const awaitListener = async (
  sandbox: ToolSandbox,
  port: number,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined
): AsyncResult<void, string> => {
  const listening = await waitForListener(sandbox, port, { signal, sleep });
  if (!listening.ok) {
    return err(describeError(listening.error));
  }
  switch (listening.value) {
    case "loopback":
      return err(
        `The server on port ${port} only listens on localhost, which the preview can't reach. ${startServerHint(port)}`
      );
    case "none":
      return err(
        `Nothing is listening on port ${port}. ${startServerHint(port)}`
      );
    case "reachable":
    case "unknown":
      return ok(undefined);
    default:
      return listening.value satisfies never;
  }
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

/** Pages written with `write` or `edit` preview without a server of the agent's own. */
const STATIC_PREVIEW_NOTE = `Writing an .html file shows it in the user's Preview panel on its own; plain HTML, CSS and JS need no server.`;

export const createSandboxTools = ({
  onChanged,
  onOutput,
  reviewFor,
  sandbox,
  sleep = wait,
}: SandboxToolsOptions): Record<SandboxToolName, Tool> => {
  /** Applies a change, then tells `onChanged` if any of it landed. */
  const change = async (
    input: ChangeInput,
    toolCallId: string
  ): Promise<FileChangeOutput> => {
    const output = await applySandboxChange(
      sandbox,
      input,
      await reviewFor?.(toolCallId)
    );
    if (output.status === "changed" && output.applied.length > 0) {
      await onChanged?.(input.input.path);
    }
    return output;
  };
  return {
    bash: tool({
      description: `Run a bash command in the chat's workspace, a sandboxed machine. The working directory is the workspace root, ${WORKDIR}; files there persist between calls and the user sees them in the Files panel. Run commands yourself rather than asking the user to.`,
      execute: async (
        { command, cwd, timeoutMs },
        { abortSignal, toolCallId }
      ) => {
        const result = await sandbox.exec(command, {
          cwd,
          onOutput: onOutput
            ? (chunk) => onOutput(toolCallId, chunk)
            : undefined,
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
      description: `Replace an exact string in a text file in the workspace (${WORKDIR}, the user's Files panel). The change is shown to the user as a diff and may be applied only in part. ${STATIC_PREVIEW_NOTE}`,
      execute: (input, { toolCallId }) =>
        change({ input, kind: "edit" }, toolCallId),
      inputSchema: editInputSchema,
      outputSchema: fileChangeOutputSchema,
    }),

    preview: tool({
      description: `Expose a port a server in the workspace listens on and get a URL the user can open in the preview panel. This is for dev servers (Vite and the like): static HTML, CSS and JS preview on their own when you write the .html file, so don't start a server for them. Start the server first, in the background and bound to 0.0.0.0 (e.g. \`npm run dev -- --host 0.0.0.0 --port 5173 &\`); a server bound to localhost can't be previewed. Don't use port ${STATIC_PREVIEW_PORT}; the static preview has it. Only preview something that serves pages: a library or script with no server has nothing to show.`,
      execute: async ({ port }, { abortSignal }) => {
        const listening = await awaitListener(
          sandbox,
          port,
          sleep,
          abortSignal
        );
        if (!listening.ok) {
          return failure(listening.error);
        }
        const exposed = await sandbox.exposePort(port);
        return exposed.ok
          ? { ...exposed.value, status: "exposed" as const }
          : failure(describeError(exposed.error));
      },
      inputSchema: previewInputSchema,
      outputSchema: previewOutputSchema,
    }),

    read: tool({
      description: `Read a text file from the workspace (${WORKDIR}, the user's Files panel), optionally a range of lines. Relative paths are relative to ${WORKDIR}.`,
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
      description: `Create or overwrite a text file in the workspace (${WORKDIR}, the user's Files panel). The change is shown to the user as a diff and may be applied only in part. ${STATIC_PREVIEW_NOTE}`,
      execute: (input, { toolCallId }) =>
        change({ input, kind: "write" }, toolCallId),
      inputSchema: writeInputSchema,
      outputSchema: fileChangeOutputSchema,
    }),
  };
};
