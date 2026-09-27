import type {
  InstancePolicy,
  OrgPolicy,
  PolicyAdjustment,
} from "@workspace/contract/schemas/tenancy";

// Config layering (D18): app.config.yaml sets instance limits, each org
// chooses within them. The org's stored choice is kept as-is (so relaxing an
// instance limit later restores it); this computes what actually applies.

export interface ClampedOrgPolicy {
  readonly adjustments: readonly PolicyAdjustment[];
  readonly effective: OrgPolicy;
}

/** The org policy that applies under the instance limits, and what changed. */
export const clampOrgPolicy = (
  stored: OrgPolicy,
  limits: InstancePolicy
): ClampedOrgPolicy => {
  const adjustments: PolicyAdjustment[] = [];
  const forbid = (
    field: PolicyAdjustment["field"],
    wanted: boolean,
    allowance: "allowed" | "forbidden"
  ): boolean => {
    if (wanted && allowance === "forbidden") {
      adjustments.push({ field, reason: "forbidden_by_instance" });
      return false;
    }
    return wanted;
  };

  const auditEnabled = forbid(
    "auditEnabled",
    stored.auditEnabled,
    limits.auditPolicy
  );
  const personalKeyFallback = forbid(
    "personalKeyFallback",
    stored.personalKeyFallback,
    limits.personalKeyFallback
  );
  const sampledScoring = forbid(
    "sampledScoring",
    stored.sampledScoring,
    limits.sampledScoring
  );
  const persistClientCache = forbid(
    "persistClientCache",
    stored.persistClientCache,
    limits.persistClientCache
  );

  const allowedContexts = stored.chatContexts.filter((context) =>
    limits.chatContext.includes(context)
  );
  if (allowedContexts.length !== stored.chatContexts.length) {
    adjustments.push({
      field: "chatContexts",
      reason: "not_allowed_by_instance",
    });
  }
  // An org can't end up with no context at all; fall back to what the
  // instance allows (always non-empty).
  const chatContexts =
    allowedContexts.length > 0 ? allowedContexts : [...limits.chatContext];

  const publishGateAllowed = limits.publishGate.allowed.includes(
    stored.publishGate
  );
  if (!publishGateAllowed) {
    adjustments.push({
      field: "publishGate",
      reason: "not_allowed_by_instance",
    });
  }

  return {
    adjustments,
    effective: {
      auditEnabled,
      chatContexts,
      persistClientCache,
      personalKeyFallback,
      publishGate: publishGateAllowed
        ? stored.publishGate
        : limits.publishGate.default,
      sampledScoring,
    },
  };
};
