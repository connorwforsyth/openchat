import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  type InterruptedBy,
  type Interruption,
  interruptionOf,
} from "@workspace/ai/messages/approval";
import {
  isSkillAuthoringTool,
  type SkillAuthoringOutput,
  type SkillAuthoringTool,
  skillAuthoringOutputSchema,
} from "@workspace/ai/tools/registry/skill-authoring";
import type { JsonValue } from "@workspace/contract/schemas/common";
import type { IconName } from "@workspace/icons/names";
import { z } from "zod";

import type { ToolCallPart, ToolResultPart } from "./parts";

// A tool call as the quiet status line the conversation shows ("Ran `ls`",
// "Searched the web"), in the manner of shadcn's chatbot template: people
// see what the agent did, not the JSON it did it with. Pure, so every tool
// kind is tested without rendering. Labels are Lingui descriptors; a
// `code` value renders in code font (the command, a path, a tool name).
//
// The result shapes are the sandbox tools' (`packages/sandbox/src/tools/
// tools.ts`), `web_search`'s and MCP's, parsed loosely: a result this
// doesn't recognise still gets a line, just a less specific one.

export const toolStatusSchema = z.enum([
  /** Waiting for someone to approve it. */
  "awaiting",
  "running",
  "done",
  "error",
  /** Rejected by the approver, or every proposed hunk was. */
  "denied",
  /** Its run was stopped first: it never ran, or was killed mid-way (072). */
  "stopped",
]);
export type ToolStatus = z.infer<typeof toolStatusSchema>;

/** The icons a status line can show. */
export type ToolIconName = Extract<
  IconName,
  | "FileIcon"
  | "FileTextIcon"
  | "GlobeIcon"
  | "MonitorIcon"
  | "PencilIcon"
  | "SearchIcon"
  | "SparklesIcon"
  | "TerminalIcon"
  | "ToolIcon"
  | "WrenchIcon"
>;

/** What a `write` or `edit` changed, for the file-change card. */
export interface FileChange {
  /** Lines added by the hunks that were applied. */
  readonly added: number;
  readonly change: "created" | "edited";
  readonly path: string;
  /** Hunks the reviewer rejected; the file kept their original lines. */
  readonly rejected: number;
  readonly removed: number;
}

/** What expanding the line shows. */
export type ToolDetail =
  | {
      readonly command: string;
      readonly kind: "bash";
      /** The end of stdout and stderr; empty until it has run. */
      readonly stderr: string;
      readonly stdout: string;
    }
  | { readonly change: FileChange; readonly kind: "file-change" }
  | {
      readonly kind: "skill";
      /** What a skill tool saved or published (128), for the skill card. */
      readonly result: Exclude<SkillAuthoringOutput, { status: "error" }>;
      readonly tool: SkillAuthoringTool;
    }
  | {
      readonly input: JsonValue;
      readonly kind: "raw";
      readonly output: JsonValue | undefined;
    };

export interface ToolSummary {
  readonly detail: ToolDetail;
  /** Why it failed, in the tool's words, for an `error` line. */
  readonly errorText?: string;
  readonly icon: ToolIconName;
  readonly label: MessageDescriptor;
  /** A preview's URL, for its Open button. */
  readonly previewUrl?: string;
  readonly status: ToolStatus;
  /** Who stopped its run, for a `stopped` line. */
  readonly stoppedBy?: InterruptedBy;
}

/** How long a command may be in the line before it's cut. */
export const COMMAND_MAX_CHARS = 60;
/** How much of a command's output expanding the line shows. */
export const OUTPUT_TAIL_LINES = 20;
const OUTPUT_TAIL_CHARS = 4000;

/** A command's first line, cut to fit the status line. */
export const shortCommand = (command: string): string => {
  const lines = command.trim().split("\n");
  const first = lines[0] ?? "";
  const cut = first.length > COMMAND_MAX_CHARS || lines.length > 1;
  return cut ? `${first.slice(0, COMMAND_MAX_CHARS - 1).trimEnd()}…` : first;
};

/** The last lines of some output, which is where errors and results are. */
export const outputTail = (text: string): string => {
  const lines = text.trimEnd().split("\n");
  const tail = lines.slice(-OUTPUT_TAIL_LINES).join("\n");
  return tail.length > OUTPUT_TAIL_CHARS
    ? tail.slice(-OUTPUT_TAIL_CHARS)
    : tail;
};

interface HunkStats {
  readonly added: number;
  readonly removed: number;
}

/**
 * Lines added and removed per hunk of a unified diff, and whether it creates
 * the file (`@@ -0,0`). Only hunk bodies count: the `---` header carries the
 * base file's hash (ticket 056), and a removed line can itself start `---`.
 */
export const patchStats = (
  patch: string
): { readonly created: boolean; readonly hunks: readonly HunkStats[] } => {
  const hunks: HunkStats[] = [];
  let created = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      if (hunks.length === 0) {
        created = line.startsWith("@@ -0,0 ");
      }
      hunks.push({ added: 0, removed: 0 });
      continue;
    }
    const current = hunks.at(-1);
    if (current && line.startsWith("+")) {
      hunks[hunks.length - 1] = { ...current, added: current.added + 1 };
    } else if (current && line.startsWith("-")) {
      hunks[hunks.length - 1] = { ...current, removed: current.removed + 1 };
    }
  }
  return { created, hunks };
};

// What the status line reads from inputs and results.
const pathInputSchema = z.object({ path: z.string().min(1) });
const commandInputSchema = z.object({ command: z.string() });
const toolErrorSchema = z.object({
  message: z.string(),
  status: z.enum(["error", "unavailable"]),
});
const bashResultSchema = z.object({
  exitCode: z.int(),
  status: z.literal("ran"),
  stderr: z.string(),
  stdout: z.string(),
  timedOut: z.boolean().optional(),
});
const fileChangeResultSchema = z.discriminatedUnion("status", [
  z.object({ path: z.string(), status: z.literal("unchanged") }),
  z.object({
    applied: z.array(z.string()),
    edit: z.object({
      hunks: z.array(z.object({ hunkId: z.string() })),
      patch: z.string(),
      path: z.string(),
    }),
    rejected: z.array(z.string()),
    status: z.literal("changed"),
  }),
]);
const previewResultSchema = z.object({
  status: z.literal("exposed"),
  url: z.string(),
});
/** An MCP `CallToolResult` the server marked as failed. */
const mcpErrorSchema = z.object({
  content: z
    .array(z.object({ text: z.string().optional(), type: z.string() }))
    .optional(),
  isError: z.literal(true),
});

const MCP_SEPARATOR = "__";

/** What the result says went wrong, if it did. */
const errorOf = (result: ToolResultPart | undefined): string | undefined => {
  if (result?.output.status === "error") {
    return result.output.message;
  }
  if (result?.output.status !== "success") {
    return;
  }
  const { value } = result.output;
  const failed = toolErrorSchema.safeParse(value);
  if (failed.success) {
    return failed.data.message;
  }
  const mcp = mcpErrorSchema.safeParse(value);
  if (mcp.success) {
    return (
      mcp.data.content
        ?.flatMap((part) => (part.text ? [part.text] : []))
        .join("\n") ?? ""
    );
  }
};

/** A status a call reaches by itself; `stopped` comes from its run. */
type LiveStatus = Exclude<ToolStatus, "stopped">;

const statusOf = (
  call: ToolCallPart,
  result: ToolResultPart | undefined,
  errorText: string | undefined
): LiveStatus => {
  if (result) {
    if (result.output.status === "denied") {
      return "denied";
    }
    return errorText === undefined ? "done" : "error";
  }
  return call.approval.state === "pending" ? "awaiting" : "running";
};

const successValue = (result: ToolResultPart | undefined) =>
  result?.output.status === "success" ? result.output.value : undefined;

const rawDetail = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): ToolDetail => {
  let output: JsonValue | undefined;
  switch (result?.output.status) {
    case "success":
      output = result.output.value;
      break;
    case "denied":
      output = result.output.decision;
      break;
    default:
      output = undefined;
  }
  return { input: call.input, kind: "raw", output };
};

/**
 * A `stopped` line reads as what the call was doing (or wanted to do) when
 * its run stopped, followed by who stopped it.
 */
type Labels = Readonly<Record<LiveStatus, MessageDescriptor>>;

// Each label is its own literal so extraction finds it; `code` is the value
// shown in code font.
const bashLabels = (code: string): Labels => ({
  awaiting: msg`Wants to run ${code}`,
  denied: msg`Didn't run ${code}`,
  done: msg`Ran ${code}`,
  error: msg`Couldn't run ${code}`,
  running: msg`Running ${code}`,
});

const readLabels = (code: string): Labels => ({
  awaiting: msg`Wants to read ${code}`,
  denied: msg`Didn't read ${code}`,
  done: msg`Read ${code}`,
  error: msg`Couldn't read ${code}`,
  running: msg`Reading ${code}`,
});

const fileChangeLabels = (code: string, tool: "write" | "edit"): Labels => ({
  awaiting: msg`Wants to change ${code}`,
  denied: msg`Didn't change ${code}`,
  done: msg`Changed ${code}`,
  error: msg`Couldn't change ${code}`,
  running: tool === "write" ? msg`Writing ${code}` : msg`Editing ${code}`,
});

const previewLabels: Labels = {
  awaiting: msg`Wants to open a preview`,
  denied: msg`Didn't open a preview`,
  done: msg`Opened a preview`,
  error: msg`Couldn't open a preview`,
  running: msg`Opening a preview`,
};

const fileSearchLabels: Labels = {
  awaiting: msg`Wants to search your files`,
  denied: msg`Didn't search your files`,
  done: msg`Searched your files`,
  error: msg`Couldn't search your files`,
  running: msg`Searching your files`,
};

const webSearchLabels: Labels = {
  awaiting: msg`Wants to search the web`,
  denied: msg`Didn't search the web`,
  done: msg`Searched the web`,
  error: msg`Couldn't search the web`,
  running: msg`Searching the web`,
};

const mcpLabels = (code: string, server: string): Labels => ({
  awaiting: msg`Wants to use ${code} from ${server}`,
  denied: msg`Didn't use ${code} from ${server}`,
  done: msg`Used ${code} from ${server}`,
  error: msg`Couldn't use ${code} from ${server}`,
  running: msg`Using ${code} from ${server}`,
});

// A skill's name isn't code: it's a plain value (`name`), not `code`.
const skillLabels = (tool: SkillAuthoringTool, name: string): Labels => {
  switch (tool) {
    case "create_skill":
      return name
        ? {
            awaiting: msg`Wants to create the skill ${name}`,
            denied: msg`Didn't create the skill ${name}`,
            done: msg`Created the skill ${name}`,
            error: msg`Couldn't create the skill ${name}`,
            running: msg`Creating the skill ${name}`,
          }
        : {
            awaiting: msg`Wants to create a skill`,
            denied: msg`Didn't create a skill`,
            done: msg`Created a skill`,
            error: msg`Couldn't create a skill`,
            running: msg`Creating a skill`,
          };
    case "update_skill":
      return name
        ? {
            awaiting: msg`Wants to change the skill ${name}`,
            denied: msg`Didn't change the skill ${name}`,
            done: msg`Changed the skill ${name}`,
            error: msg`Couldn't change the skill ${name}`,
            running: msg`Changing the skill ${name}`,
          }
        : {
            awaiting: msg`Wants to change a skill`,
            denied: msg`Didn't change a skill`,
            done: msg`Changed a skill`,
            error: msg`Couldn't change a skill`,
            running: msg`Changing a skill`,
          };
    case "publish_skill":
      return name
        ? {
            awaiting: msg`Wants to publish the skill ${name}`,
            denied: msg`Didn't publish the skill ${name}`,
            done: msg`Published the skill ${name}`,
            error: msg`Couldn't publish the skill ${name}`,
            running: msg`Publishing the skill ${name}`,
          }
        : {
            awaiting: msg`Wants to publish a skill`,
            denied: msg`Didn't publish a skill`,
            done: msg`Published a skill`,
            error: msg`Couldn't publish a skill`,
            running: msg`Publishing a skill`,
          };
    default:
      return tool satisfies never;
  }
};

const toolLabels = (code: string): Labels => ({
  awaiting: msg`Wants to use ${code}`,
  denied: msg`Didn't use ${code}`,
  done: msg`Used ${code}`,
  error: msg`Couldn't use ${code}`,
  running: msg`Using ${code}`,
});

const pathOf = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): string => {
  const input = pathInputSchema.safeParse(call.input);
  if (input.success) {
    return input.data.path;
  }
  const changed = fileChangeResultSchema.safeParse(successValue(result));
  if (changed.success) {
    return changed.data.status === "changed"
      ? changed.data.edit.path
      : changed.data.path;
  }
  return "";
};

const bashSummary = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): ToolSummary => {
  const input = commandInputSchema.safeParse(call.input);
  const command = input.success ? input.data.command : "";
  const code = shortCommand(command);
  let errorText = errorOf(result);
  let status = statusOf(call, result, errorText);
  let label = bashLabels(code)[status];
  const ran = bashResultSchema.safeParse(successValue(result));
  if (ran.success && status === "done" && ran.data.exitCode !== 0) {
    // It ran, but failed: say so, with stderr for the why.
    const { exitCode } = ran.data;
    status = "error";
    label = ran.data.timedOut
      ? msg`${code} timed out`
      : msg`${code} exited with code ${exitCode}`;
    errorText = outputTail(ran.data.stderr).split("\n").at(-1) || undefined;
  }
  return {
    detail: {
      command,
      kind: "bash",
      stderr: ran.success ? outputTail(ran.data.stderr) : "",
      stdout: ran.success ? outputTail(ran.data.stdout) : "",
    },
    ...(errorText ? { errorText } : {}),
    icon: "TerminalIcon",
    label,
    status,
  };
};

/** The card's numbers: only hunks that were applied count. */
const fileChangeOf = (
  value: z.infer<typeof fileChangeResultSchema>
): FileChange | null => {
  if (value.status !== "changed" || value.applied.length === 0) {
    return null;
  }
  const applied = new Set(value.applied);
  const stats = patchStats(value.edit.patch);
  const counted = stats.hunks.filter((_, index) => {
    const hunkId = value.edit.hunks[index]?.hunkId;
    return hunkId !== undefined && applied.has(hunkId);
  });
  return {
    added: counted.reduce((sum, hunk) => sum + hunk.added, 0),
    change: stats.created ? "created" : "edited",
    path: value.edit.path,
    rejected: value.rejected.length,
    removed: counted.reduce((sum, hunk) => sum + hunk.removed, 0),
  };
};

const fileChangeSummary = (
  call: ToolCallPart,
  result: ToolResultPart | undefined,
  tool: "write" | "edit"
): ToolSummary => {
  const path = pathOf(call, result);
  const errorText = errorOf(result);
  const status = statusOf(call, result, errorText);
  const icon = tool === "write" ? "FileIcon" : "PencilIcon";
  const base = {
    ...(errorText ? { errorText } : {}),
    detail: rawDetail(call, result),
    icon,
    label: fileChangeLabels(path, tool)[status],
    status,
  } satisfies ToolSummary;
  const parsed = fileChangeResultSchema.safeParse(successValue(result));
  if (status !== "done" || !parsed.success) {
    return base;
  }
  if (parsed.data.status === "unchanged") {
    return { ...base, label: msg`No changes to ${path}` };
  }
  const change = fileChangeOf(parsed.data);
  if (!change) {
    // Every hunk was rejected in review: nothing was written.
    return {
      ...base,
      label: fileChangeLabels(path, tool).denied,
      status: "denied",
    };
  }
  const code = change.path;
  return {
    ...base,
    detail: { change, kind: "file-change" },
    label:
      change.change === "created" ? msg`Created ${code}` : msg`Edited ${code}`,
  };
};

const labelled = (
  call: ToolCallPart,
  result: ToolResultPart | undefined,
  icon: ToolIconName,
  labels: Labels
): ToolSummary => {
  const errorText = errorOf(result);
  const status = statusOf(call, result, errorText);
  return {
    detail: rawDetail(call, result),
    ...(errorText ? { errorText } : {}),
    icon,
    label: labels[status],
    status,
  };
};

const skillInputSchema = z.looseObject({
  name: z.string().optional(),
  skillName: z.string().optional(),
});

const skillSummary = (
  call: ToolCallPart,
  result: ToolResultPart | undefined,
  tool: SkillAuthoringTool
): ToolSummary => {
  const parsed = skillAuthoringOutputSchema.safeParse(successValue(result));
  const saved =
    parsed.success && parsed.data.status !== "error" ? parsed.data : null;
  const input = skillInputSchema.safeParse(call.input);
  const name =
    saved?.skill.name ??
    (input.success ? (input.data.skillName ?? input.data.name) : undefined) ??
    "";
  const summary = labelled(
    call,
    result,
    "SparklesIcon",
    skillLabels(tool, name)
  );
  return saved && summary.status === "done"
    ? { ...summary, detail: { kind: "skill", result: saved, tool } }
    : summary;
};

const summaryOf = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): ToolSummary => {
  switch (call.toolName) {
    case "bash":
      return bashSummary(call, result);
    case "read":
      return labelled(
        call,
        result,
        "FileTextIcon",
        readLabels(pathOf(call, result))
      );
    case "write":
    case "edit":
      return fileChangeSummary(call, result, call.toolName);
    case "preview": {
      const summary = labelled(call, result, "MonitorIcon", previewLabels);
      const exposed = previewResultSchema.safeParse(successValue(result));
      return exposed.success
        ? { ...summary, previewUrl: exposed.data.url }
        : summary;
    }
    case "file_search":
      return labelled(call, result, "SearchIcon", fileSearchLabels);
    case "web_search":
      return labelled(call, result, "GlobeIcon", webSearchLabels);
    default: {
      if (isSkillAuthoringTool(call.toolName)) {
        return skillSummary(call, result, call.toolName);
      }
      // MCP tools are `server__tool`; the server part never contains `__`.
      const split = call.toolName.indexOf(MCP_SEPARATOR);
      if (split > 0) {
        const server = call.toolName.slice(0, split);
        const code = call.toolName.slice(split + MCP_SEPARATOR.length);
        return labelled(call, result, "WrenchIcon", mcpLabels(code, server));
      }
      return labelled(call, result, "ToolIcon", toolLabels(call.toolName));
    }
  }
};

/**
 * A call its stopped run left behind: labelled with what it was about to do
 * or doing, and for a killed command, what it had printed (072).
 */
const stoppedSummary = (
  call: ToolCallPart,
  interruption: Interruption
): ToolSummary => {
  const before = summaryOf(call, undefined);
  const detail: ToolDetail =
    before.detail.kind === "bash"
      ? { ...before.detail, stdout: outputTail(interruption.partial ?? "") }
      : before.detail;
  return {
    detail,
    icon: before.icon,
    label: before.label,
    status: "stopped",
    stoppedBy: interruption.by,
  };
};

/** The status line for a tool call and its result, if it has one yet. */
export const toolSummary = (
  call: ToolCallPart,
  result: ToolResultPart | undefined
): ToolSummary => {
  const interruption =
    result?.output.status === "error"
      ? interruptionOf(result.output.message)
      : null;
  return interruption
    ? stoppedSummary(call, interruption)
    : summaryOf(call, result);
};
