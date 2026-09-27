import { describe, expect, it } from "vitest";

import { initialsOf } from "./people";

describe("initialsOf", () => {
  it("takes up to two initials from names and emails", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("bo")).toBe("B");
    expect(initialsOf("maya.chen@example.test")).toBe("MC");
    expect(initialsOf("")).toBe("?");
  });
});
