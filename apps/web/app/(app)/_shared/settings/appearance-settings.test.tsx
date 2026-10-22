import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import type { UserSettings } from "@workspace/contract/schemas/meta";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { useApi } from "@/app/(app)/_shared/api";
import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame } from "@/app/(app)/_shared/frame-fixture";
import { useSidebarLayoutSetting } from "@/app/(app)/_shared/sidebar-layout";
import {
  apiError,
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

/** The harness over settings this browser kept from an earlier visit. */
const RestoredHarness = ({ restored }: { readonly restored: UserSettings }) => {
  const queryClient = useQueryClient();
  const { query } = useApi();
  useState(() =>
    queryClient.setQueryData(query.me.settings.queryKey(), restored, {
      updatedAt: 0,
    })
  );
  return <Harness />;
};

/** A response the test hands back when it chooses. */
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Another tab of this browser choosing a layout. */
const otherTabStores = (value: string) => {
  const oldValue = window.localStorage.getItem(KEY);
  window.localStorage.setItem(KEY, value);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: KEY,
      newValue: value,
      oldValue,
      storageArea: window.localStorage,
    })
  );
};

const settle = () => new Promise((done) => setTimeout(done, 200));

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

  it("takes another tab's switch instead of writing the old choice back", async () => {
    window.localStorage.setItem(KEY, "rail");
    const api = account({ sidebarLayout: "rail" }).api();
    renderWithApi(<Harness />, api);
    await waitFor(() =>
      expect(api.calls.map((call) => call.route)).toContain("GET /me/settings")
    );
    await settle();

    act(() => otherTabStores("classic"));
    await settle();
    expect(window.localStorage.getItem(KEY)).toBe("classic");
    expect(pressed("Classic")).toBe("true");
    // The tab that switched saves it; this one only follows.
    expect(api.calls.map((call) => call.route)).not.toContain(
      "PATCH /me/settings"
    );
  });

  it("keeps a switch when an older settings response lands after it", async () => {
    const stale = deferred<UserSettings>();
    const api = fakeApi({
      "GET /me/settings": () => stale.promise,
      "PATCH /me/settings": () => new Promise(() => undefined),
    });
    renderWithApi(<Harness />, api);

    await userEvent.click(screen.getByRole("button", { name: "Classic" }));
    stale.resolve({
      defaultContext: { type: "personal" },
      defaultTarget: null,
      locale: null,
      shortcuts: {},
      sidebarLayout: "rail",
    });
    await settle();
    expect(pressed("Classic")).toBe("true");
    expect(window.localStorage.getItem(KEY)).toBe("classic");
  });

  it("doesn't count settings kept from an earlier visit as an account with none", async () => {
    window.localStorage.setItem(KEY, "classic");
    const api = fakeApi({
      "GET /me/settings": () => apiError("INTERNAL_SERVER_ERROR", 500),
    });
    renderWithApi(
      <RestoredHarness
        restored={{
          defaultContext: { type: "personal" },
          defaultTarget: null,
          locale: null,
          shortcuts: {},
        }}
      />,
      api
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.route)).toContain("GET /me/settings")
    );
    await settle();
    expect(api.calls.map((call) => call.route)).not.toContain(
      "PATCH /me/settings"
    );
  });
});
