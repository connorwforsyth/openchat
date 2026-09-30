"use client";

import { createContext, type ReactNode, useContext } from "react";

import type { AnswerPhase } from "../model/run-activity";

// Where the run behind the conversation stands, for the rows that show it
// (072): which decisions this page has sent and how they fared, and which
// answers are still being written or wait on someone. The host (the
// connected chat) knows this from the API; rows are memoised by message
// (D28), so they read it here instead of through their props.

/** A decision this page sent, until the server's copy of the call shows it. */
export type DecisionState =
  | { readonly status: "sending" }
  | {
      /** `conflict`: already decided (another tab, someone else) or the run moved on. */
      readonly reason: "conflict" | "failed";
      readonly status: "failed";
    };

export interface RunActivity {
  /** Unfinished answers by message id; a finished one isn't listed. */
  readonly answers: ReadonlyMap<string, AnswerPhase>;
  readonly decisions: ReadonlyMap<string, DecisionState>;
  /** Sends a failed decision again. */
  readonly onRetry?: (toolCallId: string) => void;
}

const NONE: RunActivity = { answers: new Map(), decisions: new Map() };

const RunActivityContext = createContext<RunActivity>(NONE);

export function RunActivityProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: RunActivity;
}) {
  return (
    <RunActivityContext.Provider value={value}>
      {children}
    </RunActivityContext.Provider>
  );
}

export const useRunActivity = (): RunActivity => useContext(RunActivityContext);
