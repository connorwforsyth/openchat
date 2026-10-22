import { describe, expect, it } from "vitest";

import { egressPolicyFor, egressPolicySchema, hostAllowed } from "./egress";

describe("hostAllowed", () => {
  const allow = ["registry.npmjs.org", "*.githubusercontent.com"];

  it("allows a listed host exactly", () => {
    expect(hostAllowed("registry.npmjs.org", allow)).toBe(true);
  });

  it("ignores case and a trailing dot", () => {
    expect(hostAllowed("Registry.NPMJS.org.", allow)).toBe(true);
  });

  it("allows any subdomain under a wildcard, at any depth", () => {
    expect(hostAllowed("raw.githubusercontent.com", allow)).toBe(true);
    expect(hostAllowed("a.b.githubusercontent.com", allow)).toBe(true);
  });

  it("refuses the wildcard's apex and look-alike suffixes", () => {
    expect(hostAllowed("githubusercontent.com", allow)).toBe(false);
    expect(hostAllowed("evilgithubusercontent.com", allow)).toBe(false);
  });

  it("refuses hosts that only contain or extend a listed one", () => {
    expect(hostAllowed("example.com", allow)).toBe(false);
    expect(hostAllowed("registry.npmjs.org.evil.com", allow)).toBe(false);
    expect(hostAllowed("npmjs.org", allow)).toBe(false);
  });

  it("refuses everything with an empty list, and an empty host", () => {
    expect(hostAllowed("registry.npmjs.org", [])).toBe(false);
    expect(hostAllowed("", allow)).toBe(false);
    expect(hostAllowed(".", allow)).toBe(false);
  });
});

describe("egressPolicyFor", () => {
  it("carries the list only under allowlist", () => {
    expect(egressPolicyFor({ allow: ["pypi.org"], mode: "open" })).toEqual({
      mode: "open",
    });
    expect(egressPolicyFor({ allow: ["pypi.org"], mode: "allowlist" })).toEqual(
      { allow: ["pypi.org"], mode: "allowlist" }
    );
  });

  it("parses back what it builds, and rejects a list entry that isn't a host", () => {
    const policy = egressPolicyFor({
      allow: ["*.pypi.org"],
      mode: "allowlist",
    });
    expect(egressPolicySchema.parse(policy)).toEqual(policy);
    expect(
      egressPolicySchema.safeParse({ allow: ["*"], mode: "allowlist" }).success
    ).toBe(false);
  });
});
