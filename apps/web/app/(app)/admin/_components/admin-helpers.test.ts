import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import {
  instancePolicySchema,
  orgPolicySchema,
  type Team,
} from "@workspace/contract/schemas/tenancy";
import { describe, expect, it } from "vitest";

import { formatMicros, usdToMicros } from "./money";
import { policyFormState, toggleContext } from "./policy-state";
import { buildTeamTree, flattenTree, subtreeIds } from "./team-tree";

const limits = (input: object = {}) => instancePolicySchema.parse(input);
const policy = (input: object = {}) => orgPolicySchema.parse(input);

describe("policyFormState", () => {
  it("leaves everything open under default limits", () => {
    const state = policyFormState(policy(), limits());
    expect(state.adjustments).toEqual([]);
    expect(state.auditEnabled).toBe("open");
    expect(state.chatContexts).toEqual({
      org: "open",
      personal: "open",
      team: "open",
    });
  });

  it("locks what the instance forbids and previews the clamp", () => {
    const state = policyFormState(
      policy({ auditEnabled: true, personalKeyFallback: true }),
      limits({ auditPolicy: "forbidden", personalKeyFallback: "forbidden" })
    );
    expect(state.auditEnabled).toBe("locked_off");
    expect(state.personalKeyFallback).toBe("locked_off");
    expect(state.effective.auditEnabled).toBe(false);
    expect(state.adjustments.map((each) => each.field)).toEqual([
      "auditEnabled",
      "personalKeyFallback",
    ]);
  });

  it("locks contexts and gates the instance doesn't allow", () => {
    const state = policyFormState(
      policy({ publishGate: "no-regressions" }),
      limits({
        chatContext: ["personal"],
        publishGate: { allowed: ["informational"], default: "informational" },
      })
    );
    expect(state.chatContexts).toEqual({
      org: "locked_off",
      personal: "locked_on",
      team: "locked_off",
    });
    expect(state.publishGate["no-regressions"]).toBe("locked_off");
    expect(state.effective.chatContexts).toEqual(["personal"]);
    expect(state.effective.publishGate).toBe("informational");
  });
});

describe("toggleContext", () => {
  it("adds and removes, but never empties the list", () => {
    const start = policy({ chatContexts: ["personal"] });
    expect(toggleContext(start, "team", true).chatContexts).toEqual([
      "personal",
      "team",
    ]);
    expect(toggleContext(start, "personal", false)).toBe(start);
  });
});

describe("team tree", () => {
  const team = (n: number, name: string, parent: number | null): Team => ({
    createdAt: fixtureTime(n),
    id: fixtureId("team", n),
    name,
    orgId: fixtureId("org", 1),
    parentId: parent === null ? null : fixtureId("team", parent),
  });
  const teams = [
    team(1, "Engineering", null),
    team(2, "Platform", 1),
    team(3, "Design", null),
    team(4, "Infra", 2),
    team(5, "Orphan", 99),
  ];

  it("nests by parent, siblings by name, orphans at the top", () => {
    const flat = flattenTree(buildTeamTree(teams)).map(
      (node) => `${"-".repeat(node.depth)}${node.team.name}`
    );
    expect(flat).toEqual([
      "Design",
      "Engineering",
      "-Platform",
      "--Infra",
      "Orphan",
    ]);
  });

  it("finds a subtree so a team can't move under itself", () => {
    expect([...subtreeIds(teams, fixtureId("team", 1))]).toEqual([
      fixtureId("team", 1),
      fixtureId("team", 2),
      fixtureId("team", 4),
    ]);
  });
});

describe("money", () => {
  it("parses dollar amounts to integer micros", () => {
    expect(usdToMicros("12.50")).toBe(12_500_000);
    expect(usdToMicros("0.000001")).toBe(1);
    expect(usdToMicros("3")).toBe(3_000_000);
    expect(usdToMicros("-1")).toBeNull();
    expect(usdToMicros("1.2345678")).toBeNull();
    expect(usdToMicros("ten")).toBeNull();
  });

  it("formats micros as currency", () => {
    expect(formatMicros(12_500_000, "en")).toBe("$12.50");
    expect(formatMicros(1500, "en")).toBe("$0.0015");
  });
});
