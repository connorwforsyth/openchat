// The seam for model-judged checks. A judge is `@workspace/ai/evals/judge`'s
// (`createJudge` over any configured model, ticket 085); this package only
// hands it the criteria and the case's transcript. Without a judge, which
// is every deterministic run, `t.judge(criteria)` is reported as skipped,
// never as passed: a check nobody made proves nothing. A judge that fails
// (a timeout, a provider error, output that isn't a verdict) fails the
// check with the judge's error; it never passes it.

export type {
  Judge,
  JudgeError,
  JudgeRequest,
  /** One exchange of a case, as a judge reads it. */
  JudgeTurn as JudgedTurn,
  JudgeVerdict,
} from "@workspace/ai/evals/judge";
