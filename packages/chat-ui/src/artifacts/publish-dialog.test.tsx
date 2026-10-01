import { describe, expect, it } from "vitest";

import { publishProblem } from "./publish-dialog";

describe("publishProblem", () => {
  it("tells a turned-off feature, the checks' issues and anything else apart", () => {
    expect(publishProblem({ code: "FEATURE_DISABLED" })).toEqual({
      kind: "disabled",
    });
    expect(
      publishProblem({
        code: "VALIDATION",
        data: {
          issues: [
            { message: "index.html loads x", path: ["id"] },
            { path: [] },
          ],
        },
      })
    ).toEqual({ issues: ["index.html loads x"], kind: "invalid" });
    expect(publishProblem({ code: "VALIDATION" })).toEqual({
      issues: [],
      kind: "invalid",
    });
    expect(publishProblem(new Error("network"))).toEqual({ kind: "failed" });
    expect(publishProblem(null)).toEqual({ kind: "failed" });
  });
});
