import {
  type Call,
  type Plan,
  planDirective,
} from "../../../e2e/support/mock-llm";

// How a case tells the mock model what to do. The model under the
// deterministic suites is `e2e/support/mock-llm.ts`: it calls exactly the
// tools the message names, if the turn offers them, and otherwise echoes.
// So a case never learns whether a model would choose a tool; it learns
// what the server does once a model has.

export const call = (name: string, args: Record<string, unknown>): Call => ({
  args,
  name,
});

/**
 * A message that makes the mock play `steps`, one per model call: a step is
 * one tool call, or several made at once. After the last step it answers
 * `Plan done after N steps. Last: <the last tool result>`.
 */
export const plan = (...steps: readonly (Call | readonly Call[])[]): string => {
  const normal: Plan = steps.map((step) => ("name" in step ? [step] : step));
  return planDirective(normal);
};

/** Makes the mock answer with the instructions the server sent it. */
export const SHOW_SYSTEM = "[show:system]";

/** Makes the mock answer with the conversation the server sent it, a line per message. */
export const SHOW_HISTORY = "[show:history]";
