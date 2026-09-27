// Labelled prompts for `auto` routing (D15 use 1), each with the evaluation
// model's recorded answer: P(the turn needs the strong model). `null` stands
// for an evaluation model that failed, which must route strong. Labels are
// what a person would pick; the recorded probabilities come from the
// Decider's fallback model and are re-recorded when its prompt changes.

export type Route = "cheap" | "strong";

export interface RoutingCase {
  readonly expected: Route;
  readonly input: string;
}

export const ROUTING_CASES: readonly RoutingCase[] = [
  { expected: "cheap", input: "hi!" },
  { expected: "cheap", input: "What's the capital of Portugal?" },
  {
    expected: "cheap",
    input: "Make this friendlier: 'Send me the report by 5.'",
  },
  { expected: "cheap", input: "Translate 'good morning' into Spanish." },
  {
    expected: "strong",
    input: "Prove there are infinitely many primes, and explain each step.",
  },
  {
    expected: "strong",
    input:
      "Refactor this 400-line TypeScript module into small pure functions and keep the tests passing.",
  },
  {
    expected: "strong",
    input:
      "Plan a zero-downtime migration of a 50-table app from MongoDB to Postgres.",
  },
  {
    expected: "strong",
    input: "Write a careful 2,000-word design doc for our billing system.",
  },
  // At the threshold (0.6 by default) the strong model wins.
  {
    expected: "strong",
    input: "Summarise these three papers and compare them.",
  },
  { expected: "cheap", input: "Summarise this paragraph in one line." },
  // The evaluation model is down: never answer worse than picking strong.
  { expected: "strong", input: "Explain monads." },
];

export const RECORDED_PROBABILITIES: Readonly<Record<string, number | null>> = {
  "Explain monads.": null,
  "hi!": 0.02,
  "Make this friendlier: 'Send me the report by 5.'": 0.12,
  "Plan a zero-downtime migration of a 50-table app from MongoDB to Postgres.": 0.81,
  "Prove there are infinitely many primes, and explain each step.": 0.86,
  "Refactor this 400-line TypeScript module into small pure functions and keep the tests passing.": 0.93,
  "Summarise these three papers and compare them.": 0.6,
  "Summarise this paragraph in one line.": 0.59,
  "Translate 'good morning' into Spanish.": 0.04,
  "What's the capital of Portugal?": 0.08,
  "Write a careful 2,000-word design doc for our billing system.": 0.77,
};
