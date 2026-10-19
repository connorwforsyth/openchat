import type { DotLastRun, DotStatus } from "@workspace/contract/schemas/dots";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { RunStatus } from "@workspace/contract/schemas/runs";
import type { ToolApprovalStatus } from "ai";

// The Dots' functional core (172): when a schedule fires next, what an
// unattended run may do, and how a Dot reads in the list. No I/O here.

/** What a tool error tells the model when an `ask` tool is refused. */
export const UNATTENDED_REFUSAL =
  "This tool needs a person to approve each call, and this Dot is running unattended on a schedule, so the call was refused. Carry on without it, and say in your reply what you would have done and that the owner can allow the tool in the Dot's settings.";

export interface UnattendedTools {
  /** Tools withheld, with the reason the model reads as the tool's error. */
  readonly refused: Readonly<Record<string, string>>;
  /** The turn's approvals with every allowed `ask` tool turned to auto. */
  readonly toolApproval: Readonly<Record<string, ToolApprovalStatus>>;
}

/**
 * The approval policy for a run nobody is watching: a tool that would ask is
 * refused, unless the Dot auto-approves it by name, in which case it runs.
 * Tools that never ask are untouched. The run never pauses for approval.
 */
export const unattendedApproval = (
  toolApproval: Readonly<Record<string, ToolApprovalStatus>>,
  autoApprove: readonly string[]
): UnattendedTools => {
  const allowed = new Set(autoApprove);
  const approvals: Record<string, ToolApprovalStatus> = {};
  const refused: Record<string, string> = {};
  for (const [name, status] of Object.entries(toolApproval)) {
    if (status !== "user-approval") {
      approvals[name] = status;
    } else if (allowed.has(name)) {
      approvals[name] = "not-applicable";
    } else {
      refused[name] = UNATTENDED_REFUSAL;
    }
  }
  return { refused, toolApproval: approvals };
};

const SNIPPET_CHARS = 280;

/** The start of a reply's text, on one line, for the list. */
export const snippetOf = (
  parts: readonly MessagePart[] | null
): string | null => {
  const text = (parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") {
    return null;
  }
  return text.length > SNIPPET_CHARS
    ? `${text.slice(0, SNIPPET_CHARS - 1)}…`
    : text;
};

const ACTIVE: ReadonlySet<RunStatus> = new Set([
  "queued",
  "running",
  "awaiting_approval",
]);

export const isActiveRun = (status: RunStatus): boolean => ACTIVE.has(status);

/** The list's pill. */
export const dotStatusOf = (lastRun: DotLastRun | null): DotStatus => {
  if (!lastRun) {
    return "idle";
  }
  if (isActiveRun(lastRun.status)) {
    return "running";
  }
  return lastRun.status === "failed" ? "failed" : "idle";
};

/** A finished run the owner hasn't opened the Dot since. */
export const isUnread = (
  lastRun: DotLastRun | null,
  lastViewedAt: Date | null
): boolean => {
  if (!lastRun?.finishedAt) {
    return false;
  }
  return lastViewedAt === null || new Date(lastRun.finishedAt) > lastViewedAt;
};

/** Failed runs in a row before a schedule pauses itself. */
export const AUTO_PAUSE_AFTER_FAILURES = 3;

/**
 * Whether a schedule should pause itself: its last `AUTO_PAUSE_AFTER_FAILURES`
 * runs (newest first) all failed. Stops a broken Dot burning a model budget
 * every minute while nobody watches.
 */
export const shouldAutoPause = (recent: readonly RunStatus[]): boolean =>
  recent.length >= AUTO_PAUSE_AFTER_FAILURES &&
  recent
    .slice(0, AUTO_PAUSE_AFTER_FAILURES)
    .every((status) => status === "failed");

/** What "Run now" asks when neither the caller nor a schedule says. */
export const DEFAULT_DOT_PROMPT =
  "Check in: do your standing task now and report what you found.";

/**
 * A Dot's run carries an idempotency key that says so. The turn reads it to
 * apply the unattended policy (the key is on the run row before the run
 * starts, unlike anything written after `createRun` returns), and a retried
 * job reuses its occurrence's key, so one firing never posts twice.
 */
export const DOT_RUN_KEY_PREFIX = "dot:";

export const dotRunKey = (
  trigger:
    | {
        readonly scheduleId: string;
        readonly occurrence: Date;
        readonly type: "schedule";
      }
    | { readonly nonce: string; readonly type: "manual" }
): string =>
  trigger.type === "schedule"
    ? `${DOT_RUN_KEY_PREFIX}s:${trigger.scheduleId}:${trigger.occurrence.toISOString()}`
    : `${DOT_RUN_KEY_PREFIX}m:${trigger.nonce}`;

export const isDotRunKey = (key: string | null | undefined): boolean =>
  key?.startsWith(DOT_RUN_KEY_PREFIX) ?? false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The schedule a run's key names: `dot:s:<schedule>:<slot>` for a slot,
 * `dot:m:<schedule>:<nonce>` for "Run now". A Dot's check-in
 * (`dot:m:<nonce>`) has none. Read at turn time, before the run's history
 * row exists.
 */
export const scheduleIdOfKey = (
  key: string | null | undefined
): string | null => {
  if (!isDotRunKey(key)) {
    return null;
  }
  const [, kind, id, rest] = (key ?? "").split(":");
  if (kind === "s" || (kind === "m" && rest !== undefined)) {
    return id && UUID.test(id) ? id : null;
  }
  return null;
};

const NOT_HANDLE = /[^a-z0-9_-]+/g;
const EDGE_DASHES = /^[-_]+|[-_]+$/g;
const HANDLE_MAX = 24;

/**
 * A free `@handle` from a Dot's name: lowercase, letters, digits, `-` and
 * `_`, 2–24 long, with `-2`, `-3`… when the owner already uses it.
 */
export const handleFrom = (name: string, taken: readonly string[]): string => {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(NOT_HANDLE, "-")
      .replace(EDGE_DASHES, "")
      .slice(0, HANDLE_MAX)
      .replace(EDGE_DASHES, "") || "dot";
  const stem = base.length < 2 ? `${base}-dot` : base;
  const used = new Set(taken);
  if (!used.has(stem)) {
    return stem;
  }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${stem.slice(0, HANDLE_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
};

/** Who the Dot is, for every turn in its chat, watched or not. */
export interface DotIdentity {
  readonly handle: string;
  readonly instructions: string;
  readonly name: string;
  readonly rules: string;
}

/**
 * The persona section of a turn in the Dot's own chat, when the owner is
 * there talking to it. Unattended runs add their own note on top.
 */
export const dotPersona = (dot: DotIdentity): string =>
  [
    `You are ${dot.name} (@${dot.handle}), the user's own always-on agent (a Dot). Talk like a capable companion: warm, brief and direct. You can run work on a schedule: use the schedule_task tool to set one up when the user asks for something recurring or later, and manage_scheduled_tasks to list, pause or resume yours.`,
    dot.instructions.trim() === ""
      ? undefined
      : `What the owner wants your help with:\n${dot.instructions.trim()}`,
    dot.rules.trim() === ""
      ? undefined
      : `The owner's rules on when to act and when to ask first:\n${dot.rules.trim()}`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
