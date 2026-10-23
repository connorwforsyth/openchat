import { describe, expect, it } from "vitest";

import { publishStateOf } from "./publish-state";

describe("publishStateOf", () => {
  it("is new until the item is created", () => {
    expect(publishStateOf("agent", null)).toEqual({ type: "new" });
  });

  it("is a draft until the first publish, shared or not", () => {
    expect(
      publishStateOf("skill", {
        latestVersionNumber: null,
        visibility: "private",
      })
    ).toEqual({ shared: false, type: "draft" });
    expect(
      publishStateOf("prompt", {
        latestVersionNumber: null,
        visibility: "shared",
      })
    ).toEqual({ shared: true, type: "draft" });
  });

  it("names the latest version once published", () => {
    expect(
      publishStateOf("agent", { latestVersionNumber: 3, visibility: "shared" })
    ).toEqual({ type: "published", version: 3 });
  });

  it("has no state for kinds without versions", () => {
    expect(
      publishStateOf("mcp_server", {
        latestVersionNumber: null,
        visibility: "private",
      })
    ).toBeNull();
    expect(publishStateOf("preset", null)).toBeNull();
  });
});
