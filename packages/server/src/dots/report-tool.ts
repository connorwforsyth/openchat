import { REPORT_TOOL, reportInputSchema } from "@workspace/ai/schedules/tool";
import { type Tool, tool } from "ai";

// How an unattended run says what it found (175): one structured call at
// the end, instead of parsing prose. `no_update` is the quiet outcome: the
// run had nothing new, so it doesn't mark anything unread or notify, and the
// thread shows it as one collapsed line. The loop stops after this call, so
// a quiet run costs one step.

export const reportTool = (): Tool =>
  tool({
    description:
      "Call this exactly once, as your very last step, to record how this scheduled run went. Write your reply to the owner first (unless the outcome is no_update, when you write nothing).",
    execute: () => Promise.resolve({ recorded: true }),
    inputSchema: reportInputSchema,
  });

/** The instructions an unattended run gets about reporting. */
export const REPORT_INSTRUCTIONS = `When you have finished, call ${REPORT_TOOL} exactly once as your last step: needs_attention if the owner should act or decide something, update if there is something new worth telling them, no_update if nothing changed (and then write nothing else). Keep the reply short.`;
