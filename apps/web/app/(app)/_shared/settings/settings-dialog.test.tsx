import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { me as meFixture } from "@workspace/contract/fixtures";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";
import { SettingsDialog } from "./settings-dialog";
import type { SettingsRoute, SettingsSection } from "./settings-route";

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
const Harness = ({ initial = null }: { readonly initial?: SettingsRoute }) => {
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
      <SettingsDialog onClose={close} onSelect={select} route={route} />
    </>
  );
};

// Clicks inside the dialog are dispatched, not pointer-driven: tests load no
// CSS, so Base UI's inert layer sits over the unstyled popup.
const dialog = () => screen.findByRole("dialog", { name: "Settings" });
const sectionHeading = (name: string) => screen.findByRole("heading", { name });

describe("SettingsDialog", () => {
  it("opens over the page on the first section and closes with Esc, back to the trigger", async () => {
    renderWithApi(<Harness />, api());
    const trigger = screen.getByRole("button", { name: "Open settings" });
    await userEvent.click(trigger);
    await dialog();
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

  it("opens on the section the address names", async () => {
    renderWithApi(<Harness initial="shortcuts" />, api());
    await dialog();
    expect(await sectionHeading("Keyboard shortcuts")).toBeTruthy();
  });

  it("switches sections from the list", async () => {
    renderWithApi(<Harness initial="profile" />, api());
    await dialog();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(await sectionHeading("Appearance")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("appearance");
  });

  it("closes from its close button", async () => {
    renderWithApi(<Harness initial="memory" />, api());
    await dialog();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("on a narrow screen shows the list, then a section with a way back", async () => {
    await page.viewport(390, 800);
    renderWithApi(<Harness initial="index" />, api());
    await dialog();
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
