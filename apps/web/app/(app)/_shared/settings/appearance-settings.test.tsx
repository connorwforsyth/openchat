import { cleanup, screen, waitFor } from "@testing-library/react";
import type { UserSettings } from "@workspace/contract/schemas/meta";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame } from "@/app/(app)/_shared/frame-fixture";
import { useSidebarLayoutSetting } from "@/app/(app)/_shared/sidebar-layout";
import {
  type FakeApi,
  fakeApi,
  renderWithApi,
} from "@/app/(app)/_shared/test-harness";

import { AppearanceSettings } from "./appearance-settings";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/appearance",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const KEY = "sidebar-layout:user-1";

beforeEach(() => window.localStorage.removeItem(KEY));
afterEach(cleanup);

/** The frame's layout setting, kept the way the app keeps it. */
const Harness = () => {
  const [sidebarLayout, setSidebarLayout] = useSidebarLayoutSetting("user-1");
  return (
    <AppFrameProvider value={testFrame({ setSidebarLayout, sidebarLayout })}>
      <AppearanceSettings />
    </AppFrameProvider>
  );
};

/** One account's settings on the server, shared by every "device". */
const account = (initial: Partial<UserSettings> = {}) => {
  let settings: UserSettings = {
    defaultContext: { type: "personal" },
    defaultTarget: null,
    locale: null,
    shortcuts: {},
    ...initial,
  };
  return {
    api: (): FakeApi =>
      fakeApi({
        "GET /me/settings": () => settings,
        "PATCH /me/settings": ({ body }) => {
          settings = { ...settings, ...(body as Partial<UserSettings>) };
          return settings;
        },
      }),
    read: () => settings,
  };
};

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("Appearance: sidebar layout (181)", () => {
  it("defaults to the rail, and saves a switch to classic to the account", async () => {
    const server = account();
    renderWithApi(<Harness />, server.api());
    expect(pressed("Rail (recommended)")).toBe("true");
    expect(pressed("Classic")).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: "Classic" }));
    expect(pressed("Classic")).toBe("true");
    expect(window.localStorage.getItem(KEY)).toBe("classic");
    await waitFor(() => expect(server.read().sidebarLayout).toBe("classic"));
  });

  it("shows the account's choice on a browser that never made one", async () => {
    const server = account({ sidebarLayout: "classic" });
    renderWithApi(<Harness />, server.api());
    await waitFor(() => expect(pressed("Classic")).toBe("true"));
    // Kept here too, for the next start before settings load.
    expect(window.localStorage.getItem(KEY)).toBe("classic");
  });

  it("answers from this browser while settings can't load", async () => {
    window.localStorage.setItem(KEY, "classic");
    const down = fakeApi({});
    renderWithApi(<Harness />, down);
    expect(pressed("Classic")).toBe("true");
    await waitFor(() =>
      expect(down.calls).toContainEqual({
        body: undefined,
        route: "GET /me/settings",
      })
    );
    expect(pressed("Classic")).toBe("true");
  });

  it("carries a choice made here up to an account that has none", async () => {
    window.localStorage.setItem(KEY, "classic");
    const server = account();
    renderWithApi(<Harness />, server.api());
    await waitFor(() => expect(server.read().sidebarLayout).toBe("classic"));
  });

  it("lets the account's choice win over this browser's", async () => {
    window.localStorage.setItem(KEY, "classic");
    renderWithApi(<Harness />, account({ sidebarLayout: "rail" }).api());
    await waitFor(() => expect(pressed("Rail (recommended)")).toBe("true"));
    expect(window.localStorage.getItem(KEY)).toBe("rail");
  });
});
