import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { SidebarLayoutProvider } from "@workspace/chat-ui/shell/sidebar-layout";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame as frame } from "@/app/(app)/_shared/frame-fixture";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";
import { PageShell } from "@/app/(app)/(pages)/page-shell";

import { LibraryScreen } from "./library-screen";
import { LibraryProviders } from "./providers";

// The Library's tabs and kinds live in one place (181): the rail's panel on
// a wide screen, the page itself in Classic and on a phone, where no panel
// shows. Never both, never neither.

const address = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    push: vi.fn((href: string) => {
      search = new URL(href, "http://app.test").search.slice(1);
      for (const listener of listeners) {
        listener();
      }
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/library",
    useRouter: () => ({
      push: address.push,
      refresh: vi.fn(),
      replace: vi.fn(),
    }),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(address.subscribe, address.get)),
  };
});

// next/link reads Node's `process` at import; a plain anchor stands in.
vi.mock("./next-link", async () => {
  const { createElement } = await import("react");
  return {
    NextLink: (props: Record<string, unknown>) => createElement("a", props),
  };
});

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(async () => {
  cleanup();
  address.push("/library");
  address.push.mockClear();
  await page.viewport(1280, 800);
});

const show = (layout: "classic" | "rail") =>
  renderWithApi(
    <AppFrameProvider value={frame({ sidebarLayout: layout })}>
      <SidebarLayoutProvider value={layout}>
        <PageShell>
          <LibraryProviders>
            <LibraryScreen />
          </LibraryProviders>
        </PageShell>
      </SidebarLayoutProvider>
    </AppFrameProvider>,
    fakeApi({ "GET /conversations": () => ({ items: [], nextCursor: null }) })
  );

const panel = () => screen.queryByRole("navigation", { name: "Library" });
const pageTabs = () => screen.queryByRole("tablist");

describe("the Library's filters", () => {
  it("are the panel's with the rail on a wide screen", () => {
    show("rail");
    expect(panel()).not.toBeNull();
    expect(pageTabs()).toBeNull();
    expect(screen.queryByRole("group", { name: "Kind" })).toBeNull();
  });

  it("are the page's in Classic, and move the address", async () => {
    show("classic");
    expect(panel()).toBeNull();
    expect(pageTabs()).not.toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Spaces" }));
    expect(address.push).toHaveBeenLastCalledWith("/library?tab=libraries");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Spaces" })).toBeTruthy()
    );
    await userEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(address.push).toHaveBeenLastCalledWith(
      "/library?tab=libraries&kind=skill"
    );
  });

  it("are the page's on a phone, rail or not", async () => {
    await page.viewport(390, 844);
    show("rail");
    expect(panel()).toBeNull();
    expect(pageTabs()).not.toBeNull();
    expect(screen.getByRole("group", { name: "Kind" })).toBeTruthy();
  });

  it("start the search afresh on a new address", async () => {
    show("rail");
    const search = screen.getByRole("searchbox", {
      name: "Search the library",
    });
    await userEvent.fill(search, "notes");
    act(() => address.push("/library?tab=shared"));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("searchbox", {
            name: "Search the library",
          }) as HTMLInputElement
        ).value
      ).toBe("")
    );
  });
});
