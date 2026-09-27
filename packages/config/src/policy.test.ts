import {
  instancePolicySchema,
  orgPolicySchema,
} from "@workspace/contract/schemas/tenancy";
import { describe, expect, it } from "vitest";

import { clampOrgPolicy } from "./policy";

const limits = (input: object = {}) => instancePolicySchema.parse(input);
const org = (input: object = {}) => orgPolicySchema.parse(input);

describe("clampOrgPolicy", () => {
  it("keeps choices that are inside the limits", () => {
    const stored = org({
      auditEnabled: true,
      personalKeyFallback: true,
      sampledScoring: true,
    });
    expect(clampOrgPolicy(stored, limits())).toEqual({
      adjustments: [],
      effective: stored,
    });
  });

  it("turns off what the instance forbids and says why", () => {
    const result = clampOrgPolicy(
      org({
        auditEnabled: true,
        personalKeyFallback: true,
        sampledScoring: true,
      }),
      limits({
        auditPolicy: "forbidden",
        personalKeyFallback: "forbidden",
        sampledScoring: "forbidden",
      })
    );
    expect(result.effective).toMatchObject({
      auditEnabled: false,
      personalKeyFallback: false,
      sampledScoring: false,
    });
    expect(result.adjustments.map((a) => a.field)).toEqual([
      "auditEnabled",
      "personalKeyFallback",
      "sampledScoring",
    ]);
  });

  it("doesn't report a forbidden setting the org left off", () => {
    expect(
      clampOrgPolicy(org(), limits({ auditPolicy: "forbidden" })).adjustments
    ).toEqual([]);
  });

  it("narrows chat contexts to the instance's, never to none", () => {
    expect(
      clampOrgPolicy(
        org({ chatContexts: ["personal", "team"] }),
        limits({ chatContext: ["personal"] })
      ).effective.chatContexts
    ).toEqual(["personal"]);
    const disjoint = clampOrgPolicy(
      org({ chatContexts: ["team"] }),
      limits({ chatContext: ["personal"] })
    );
    expect(disjoint.effective.chatContexts).toEqual(["personal"]);
    expect(disjoint.adjustments).toEqual([
      { field: "chatContexts", reason: "not_allowed_by_instance" },
    ]);
  });

  it("falls back to the instance's default publish gate", () => {
    const result = clampOrgPolicy(
      org({ publishGate: "no-regressions" }),
      limits({
        publishGate: { allowed: ["informational"], default: "informational" },
      })
    );
    expect(result.effective.publishGate).toBe("informational");
    expect(result.adjustments).toEqual([
      { field: "publishGate", reason: "not_allowed_by_instance" },
    ]);
  });

  it("keeps the client cache on disk unless the org or instance says no", () => {
    expect(clampOrgPolicy(org(), limits()).effective.persistClientCache).toBe(
      true
    );
    expect(
      clampOrgPolicy(org({ persistClientCache: false }), limits()).effective
        .persistClientCache
    ).toBe(false);
    const forbidden = clampOrgPolicy(
      org(),
      limits({ persistClientCache: "forbidden" })
    );
    expect(forbidden.effective.persistClientCache).toBe(false);
    expect(forbidden.adjustments).toEqual([
      { field: "persistClientCache", reason: "forbidden_by_instance" },
    ]);
  });

  it("doesn't mutate its inputs", () => {
    const stored = org({ auditEnabled: true, chatContexts: ["team"] });
    const snapshot = structuredClone(stored);
    clampOrgPolicy(
      stored,
      limits({ auditPolicy: "forbidden", chatContext: ["personal"] })
    );
    expect(stored).toEqual(snapshot);
  });
});
