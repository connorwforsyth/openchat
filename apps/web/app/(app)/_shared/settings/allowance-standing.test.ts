import { describe, expect, it } from "vitest";

import { allowanceStanding } from "./allowance-standing";

const member = {
  access: "member",
  canManage: false,
  parent: null,
} as const;
const subSpaceMember = {
  ...member,
  parent: { id: "parent", type: "team" },
} as const;
const pool = { monthlyTokens: 1000, myRemainingTokens: 0 };

describe("allowanceStanding", () => {
  it("tells someone outside the space that they aren't in it, not that they have 0 tokens", () => {
    expect(
      allowanceStanding(
        { access: "root_member", canManage: false, parent: null },
        pool,
        undefined
      )
    ).toEqual({ type: "not_member" });
  });

  it("says a root space with no pool sets no token limit", () => {
    expect(
      allowanceStanding(
        member,
        { monthlyTokens: null, myRemainingTokens: 0 },
        undefined
      )
    ).toEqual({ subSpace: false, type: "no_pool" });
  });

  it("leaves room for a pool above a sub-space that has none", () => {
    expect(
      allowanceStanding(
        subSpaceMember,
        { monthlyTokens: null, myRemainingTokens: 0 },
        undefined
      )
    ).toEqual({ subSpace: true, type: "no_pool" });
  });

  it("counts what's left for an approved member or an owner", () => {
    const left = { monthlyTokens: 1000, myRemainingTokens: 250 };
    expect(allowanceStanding(member, left, { status: "approved" })).toEqual({
      tokens: 250,
      type: "remaining",
    });
    expect(
      allowanceStanding(
        { access: "admin", canManage: true, parent: null },
        left,
        undefined
      )
    ).toEqual({ tokens: 250, type: "remaining" });
  });

  it("names a member's request instead of a 0", () => {
    expect(allowanceStanding(member, pool, undefined)).toEqual({
      type: "not_asked",
    });
    expect(allowanceStanding(member, pool, { status: "pending" })).toEqual({
      type: "pending",
    });
    expect(allowanceStanding(member, pool, { status: "denied" })).toEqual({
      type: "denied",
    });
  });
});
