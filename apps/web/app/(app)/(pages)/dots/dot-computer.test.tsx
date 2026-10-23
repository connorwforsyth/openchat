import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import type { Dot } from "@workspace/contract/schemas/dots";
import { Toaster } from "@workspace/ui/components/toast";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  apiError,
  type FakeHandler,
  fakeApi,
  renderWithApi,
} from "@/app/(app)/_shared/test-harness";

import { DotComputerActions } from "./dot-computer";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const conversationId = fixtureId("conversation", 1);
const dot = { conversationId, name: "Scout" } as Dot;
const VIEW = { holder: "agent", url: "http://x-6080.sandbox.localhost/" };

const setup = (routes: Record<string, FakeHandler>) => {
  const api = fakeApi(routes);
  vi.stubGlobal("fetch", api.fetch);
  const onShow = vi.fn();
  renderWithApi(
    <Toaster>
      <DotComputerActions dot={dot} onShow={onShow} />
    </Toaster>,
    api
  );
  const posts = () =>
    api.calls
      .map((call) => call.route)
      .filter((route) => route.startsWith("POST"));
  return { onShow, posts };
};

/** A click that skips the closing menu's backdrop, as the dialog opens over it. */
const press = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
};

const openMenu = async () =>
  await userEvent.click(
    screen.getByRole("button", { name: "Scout's computer options" })
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Dot computer's Restart and Reset", () => {
  it("restarts at once and shows the computer", async () => {
    const { onShow, posts } = setup({
      "POST /computer/:id/restart": () => VIEW,
    });
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Restart computer" })
    );
    await waitFor(() =>
      expect(posts()).toEqual([`POST /computer/${conversationId}/restart`])
    );
    expect(onShow).toHaveBeenCalledOnce();
  });

  it("resets only after the owner confirms", async () => {
    const { posts } = setup({ "POST /computer/:id/reset": () => VIEW });
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Reset computer…" })
    );
    await press(await screen.findByRole("button", { name: "Cancel" }));
    expect(posts()).toEqual([]);

    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Reset computer…" })
    );
    await press(await screen.findByRole("button", { name: "Reset computer" }));
    await waitFor(() =>
      expect(posts()).toEqual([`POST /computer/${conversationId}/reset`])
    );
  });

  it("says why when the runner isn't there", async () => {
    setup({
      "POST /computer/:id/restart": () => apiError("UNAVAILABLE", 503),
    });
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Restart computer" })
    );
    expect(
      await screen.findByText("Couldn't restart Scout's computer")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The computer isn't available right now. Check that the sandbox runner is running."
      )
    ).toBeTruthy();
  });
});
