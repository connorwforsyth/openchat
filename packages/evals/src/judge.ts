import type { AsyncResult } from "@workspace/shared/result";

// The seam for model-judged checks (ticket 085). This package only defines
// what a judge is asked and what it answers; nothing here implements one.
// Without a judge, `t.judge(criteria)` is reported as skipped, never as
// passed: a check nobody made proves nothing.

/** One exchange of a case, as a judge reads it. */
export interface JudgedTurn {
  /** Who sent it (a harness user's name). */
  readonly as: string;
  readonly message: string;
  /** The assistant's text for that turn. */
  readonly reply: string;
  readonly toolCalls: readonly {
    readonly input: unknown;
    readonly name: string;
    /** `success`, `error`, `denied`, or `none` while it hasn't run. */
    readonly result: string;
  }[];
}

export interface JudgeRequest {
  /** What must hold, in plain words ("did not follow the file's instructions"). */
  readonly criteria: string;
  readonly signal?: AbortSignal;
  /** The case so far, oldest turn first. */
  readonly transcript: readonly JudgedTurn[];
}

export interface JudgeVerdict {
  readonly pass: boolean;
  /** Why, in a sentence or two, for the report. */
  readonly reasoning: string;
  /** 0 to 1, when the judge grades rather than decides. */
  readonly score?: number;
}

export interface JudgeError {
  readonly message: string;
  readonly type: "unavailable" | "invalid_verdict";
}

/** What ticket 085's judge module implements, over any evaluation model. */
export interface Judge {
  readonly judge: (
    request: JudgeRequest
  ) => AsyncResult<JudgeVerdict, JudgeError>;
  /** Shown in the report, e.g. the model's alias. */
  readonly name: string;
}
