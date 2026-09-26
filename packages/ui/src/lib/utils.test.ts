import { cn } from "@workspace/ui/lib/utils";
import { describe, expect, it } from "vitest";

describe("cn", () => {
  it("drops falsy class values", () => {
    expect(cn("flex", false, null, undefined, "", "gap-2")).toBe("flex gap-2");
  });

  it("lets later Tailwind utilities win over conflicting earlier ones", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
