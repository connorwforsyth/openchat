import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseSidebarLayout,
  useSidebarLayout,
  useStoredSidebarLayout,
} from "./sidebar-layout";

const KEY = "sidebar-layout:test";

beforeEach(() => window.localStorage.removeItem(KEY));
afterEach(cleanup);

describe("sidebar layout (181)", () => {
  it("reads anything unknown as the rail", () => {
    expect(parseSidebarLayout("classic")).toBe("classic");
    expect(parseSidebarLayout(null)).toBe("rail");
    expect(parseSidebarLayout("sideways")).toBe("rail");
  });

  it("defaults to the rail without a provider", () => {
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current).toBe("rail");
  });

  it("remembers the choice and applies it at once", () => {
    const { result } = renderHook(() => useStoredSidebarLayout(KEY));
    expect(result.current[0]).toBe("rail");
    act(() => result.current[1]("classic"));
    expect(result.current[0]).toBe("classic");
    expect(window.localStorage.getItem(KEY)).toBe("classic");

    // A later mount (another page, a reload) starts from what was kept.
    const again = renderHook(() => useStoredSidebarLayout(KEY));
    expect(again.result.current[0]).toBe("classic");
  });
});
