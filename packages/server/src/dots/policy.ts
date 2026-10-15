import type { DotLastRun, DotStatus } from "@workspace/contract/schemas/dots";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { RunStatus } from "@workspace/contract/schemas/runs";
import { err, ok, type Result } from "@workspace/shared/result";
import type { ToolApprovalStatus } from "ai";
import { CronExpressionParser } from "cron-parser";

// The Dots' functional core (172): when a schedule fires next, what an
// unattended run may do, and how a Dot reads in the list. No I/O here.

/** Five fields only: cron-parser also takes seconds, which we don't offer. */
const FIVE_FIELDS = /^\s*(\S+\s+){4}\S+\s*$/;

export type CronError =
  | { readonly type: "invalid_cron"; readonly message: string }
  | { readonly type: "invalid_timezone"; readonly message: string };

/** Whether `tz` is an IANA zone this runtime knows. */
export const isTimeZone = (tz: string): boolean => {
  try {
    return (
      new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions()
        .timeZone !== ""
    );
  } catch {
    return false;
  }
};

/**
 * The first time strictly after `now` that `cron` fires in `tz`. A bad
 * expression or zone is an error value, so the API can say which.
 */
export const nextRunAt = (
  cron: string,
  tz: string,
  now: Date
): Result<Date, CronError> => {
  if (!isTimeZone(tz)) {
    return err({
      message: `Unknown time zone: ${tz}`,
      type: "invalid_timezone",
    });
  }
  if (!FIVE_FIELDS.test(cron)) {
    return err({
      message: "Use five fields: minute hour day month weekday.",
      type: "invalid_cron",
    });
  }
  try {
    const expression = CronExpressionParser.parse(cron, {
      currentDate: now,
      strict: false,
      tz,
    });
    return ok(expression.next().toDate());
  } catch (cause) {
    return err({
      message: cause instanceof Error ? cause.message : "Invalid cron.",
      type: "invalid_cron",
    });
  }
};

/** `nextRunAt` for a stored row: `null` when disabled or unparseable. */
export const nextFor = (
  schedule: {
    readonly cron: string;
    readonly enabled: boolean;
    readonly timezone: string;
  },
  now: Date
): Date | null => {
  if (!schedule.enabled) {
    return null;
  }
  const next = nextRunAt(schedule.cron, schedule.timezone, now);
  return next.ok ? next.value : null;
};

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
