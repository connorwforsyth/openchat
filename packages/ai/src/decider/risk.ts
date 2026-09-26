import type { AppConfig } from "@workspace/config/schema";

import { type ApprovalMode, stricter } from "../tools/resolve";

// Risk scoring (D15 use 3, Desktop wave; the thresholds already live in
// config): low runs, medium asks, high blocks, always on top of the rules.
// The rule's mode is a floor: a low score never turns an `ask` into `auto`.

export type RiskThresholds = Pick<
  AppConfig["decider"]["thresholds"],
  "riskAsk" | "riskBlock"
>;

export const riskMode = (
  score: number,
  { riskAsk, riskBlock }: RiskThresholds
): ApprovalMode => {
  if (score >= riskBlock) {
    return "deny";
  }
  return score >= riskAsk ? "ask" : "auto";
};

/** The rule's mode, tightened by a risk score when the Decider gave one. */
export const withRisk = (
  rule: ApprovalMode,
  score: number | null,
  thresholds: RiskThresholds
): ApprovalMode =>
  score === null ? rule : stricter(rule, riskMode(score, thresholds));
