import { clampOrgPolicy } from "@workspace/config/policy";
import type {
  ChatContextType,
  InstancePolicy,
  OrgPolicy,
  PolicyAdjustment,
  PublishGate,
} from "@workspace/contract/schemas/tenancy";

// What the org policy form shows for each choice (D18): whether the instance
// config locks it, and what would actually apply if saved. Pure, so the UI
// states are tested without rendering; `clampOrgPolicy` is the same function
// the server runs, so the preview can't disagree with it.

export type Lock = "open" | "locked_off" | "locked_on";

export interface PolicyFormState {
  readonly adjustments: readonly PolicyAdjustment[];
  readonly auditEnabled: Lock;
  /** Per context type: whether the instance allows it at all. */
  readonly chatContexts: Readonly<Record<ChatContextType, Lock>>;
  readonly effective: OrgPolicy;
  readonly persistClientCache: Lock;
  readonly personalKeyFallback: Lock;
  readonly publishGate: Readonly<Record<PublishGate, Lock>>;
  readonly sampledScoring: Lock;
}

const allowance = (value: "allowed" | "forbidden"): Lock =>
  value === "forbidden" ? "locked_off" : "open";

export const policyFormState = (
  draft: OrgPolicy,
  limits: InstancePolicy
): PolicyFormState => {
  const { adjustments, effective } = clampOrgPolicy(draft, limits);
  const contextLock = (type: ChatContextType): Lock => {
    if (!limits.chatContext.includes(type)) {
      return "locked_off";
    }
    // The only context the instance allows can't be switched off.
    return limits.chatContext.length === 1 ? "locked_on" : "open";
  };
  const gateLock = (gate: PublishGate): Lock =>
    limits.publishGate.allowed.includes(gate) ? "open" : "locked_off";
  return {
    adjustments,
    auditEnabled: allowance(limits.auditPolicy),
    chatContexts: {
      org: contextLock("org"),
      personal: contextLock("personal"),
      team: contextLock("team"),
    },
    effective,
    persistClientCache: allowance(limits.persistClientCache),
    personalKeyFallback: allowance(limits.personalKeyFallback),
    publishGate: {
      informational: gateLock("informational"),
      "no-regressions": gateLock("no-regressions"),
    },
    sampledScoring: allowance(limits.sampledScoring),
  };
};

/** Toggles a context in the draft, never leaving it empty (the schema needs one). */
export const toggleContext = (
  draft: OrgPolicy,
  type: ChatContextType,
  on: boolean
): OrgPolicy => {
  const next = on
    ? [...new Set([...draft.chatContexts, type])]
    : draft.chatContexts.filter((each) => each !== type);
  return next.length > 0 ? { ...draft, chatContexts: next } : draft;
};
