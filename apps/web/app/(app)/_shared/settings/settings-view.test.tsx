import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { me as meFixture } from "@workspace/contract/fixtures";
import type { Space } from "@workspace/contract/schemas/spaces";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";
import type { SettingsRoute, SettingsSection } from "./settings-route";
import { SettingsView } from "./settings-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  cleanup();
});

const api = () =>
  fakeApi({
    "GET /me": () => meFixture,
    "GET /me/memory": () => ({
      content: "",
      maxChars: 4000,
      mode: "off",
      updatedAt: null,
      versionId: null,
    }),
    "GET /me/settings": () => ({
      defaultContext: { type: "personal" },
      defaultTarget: null,
      locale: null,
    }),
  });

/** The page underneath: a button that opens settings, as the account menu does. */
const Harness = ({
  initial = null,
  space,
}: {
  readonly initial?: SettingsRoute;
  readonly space?: Space;
}) => {
  const [route, setRoute] = useState<SettingsRoute>(initial);
  const open = useCallback(() => setRoute("index"), []);
  const close = useCallback(() => setRoute(null), []);
  const select = useCallback(
    (section?: SettingsSection) => setRoute(section ?? "index"),
    []
  );
  return (
    <>
      <button onClick={open} type="button">
        Open settings
      </button>
      <output data-testid="route">{String(route)}</output>
      <SettingsView
        onClose={close}
        onSelect={select}
        route={route}
        space={space}
      />
    </>
  );
};

// Clicks inside the view are dispatched, not pointer-driven: tests load no
// CSS, so Base UI's inert layer sits over the unstyled popup.
const view = () => screen.findByRole("dialog", { name: "Settings" });
const sectionHeading = (name: string) => screen.findByRole("heading", { name });

describe("SettingsView", () => {
  it("opens over the page on the first section and closes with Esc, back to the trigger", async () => {
    renderWithApi(<Harness />, api());
    const trigger = screen.getByRole("button", { name: "Open settings" });
    await userEvent.click(trigger);
    await view();
    expect(await sectionHeading("Profile and language")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Profile and language" })
        .getAttribute("aria-current")
    ).toBe("page");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("route").textContent).toBe("null");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("lists the active space's sections after yours, and only those it applies to", async () => {
    const design: Space = {
      access: "member",
      canManage: true,
      id: "0190a000-0000-7000-8000-000000000011",
      isPersonal: false,
      memberCount: 2,
      myRole: "owner",
      name: "Design",
      orgId: "0190a000-0000-7000-8000-000000000001",
      parent: { id: "0190a000-0000-7000-8000-000000000001", type: "org" },
      type: "team",
    } as Space;
    renderWithApi(<Harness initial="profile" space={design} />, api());
    await view();
    expect(screen.getByRole("heading", { name: "Space: Design" })).toBeTruthy();
    for (const name of [
      "Members",
      "Sub-spaces",
      "Token allowance",
      "Keys and usage",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Policies and audit belong to a root space.
    expect(screen.queryByRole("button", { name: "Policies" })).toBeNull();
  });

  it("has no space sections for the personal space", async () => {
    renderWithApi(<Harness initial="profile" />, api());
    await view();
    expect(
      screen.queryByRole("button", { name: "Token allowance" })
    ).toBeNull();
  });

  it("opens on the section the address names", async () => {
    renderWithApi(<Harness initial="shortcuts" />, api());
    await view();
    expect(await sectionHeading("Keyboard shortcuts")).toBeTruthy();
  });

  it("switches sections from the list", async () => {
    renderWithApi(<Harness initial="profile" />, api());
    await view();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(await sectionHeading("Appearance")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("appearance");
  });

  it("goes back to the app from the top of its sidebar", async () => {
    renderWithApi(<Harness initial="memory" />, api());
    await view();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("route").textContent).toBe("null");
  });

  it("on a narrow screen shows the list, then a section with a way back", async () => {
    await page.viewport(390, 800);
    renderWithApi(<Harness initial="index" />, api());
    await view();
    expect(
      screen.queryByRole("heading", { name: "Profile and language" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(await sectionHeading("Memory")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("navigation", { name: "Settings sections" })
    ).toBeTruthy();
  });
});
