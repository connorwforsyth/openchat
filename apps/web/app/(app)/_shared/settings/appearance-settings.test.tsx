import { cleanup, screen } from "@testing-library/react";
import { useStoredSidebarLayout } from "@workspace/chat-ui/shell/sidebar-layout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame } from "@/app/(app)/_shared/frame-fixture";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";

import { AppearanceSettings } from "./appearance-settings";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/appearance",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const KEY = "sidebar-layout:test";

beforeEach(() => window.localStorage.removeItem(KEY));
afterEach(cleanup);

/** The frame's layout setting, kept the way the app keeps it. */
const Harness = () => {
  const [sidebarLayout, setSidebarLayout] = useStoredSidebarLayout(KEY);
  return (
    <AppFrameProvider value={testFrame({ setSidebarLayout, sidebarLayout })}>
      <AppearanceSettings />
    </AppFrameProvider>
  );
};

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("Appearance: sidebar layout (181)", () => {
  it("defaults to the rail, and keeps a switch to classic", async () => {
    renderWithApi(<Harness />, fakeApi({}));
    expect(pressed("Rail (recommended)")).toBe("true");
    expect(pressed("Classic")).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: "Classic" }));
    expect(pressed("Classic")).toBe("true");
    expect(window.localStorage.getItem(KEY)).toBe("classic");

    // Coming back to the page (or a reload) shows what was kept.
    cleanup();
    renderWithApi(<Harness />, fakeApi({}));
    expect(pressed("Classic")).toBe("true");
  });
});
