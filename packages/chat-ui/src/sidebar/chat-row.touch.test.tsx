import { cleanup, fireEvent, screen } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cdp, page } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import { ChatRow, type SidebarChat } from "./chat-row";

// A chat row on a phone (181): the actions open on a long press rather than
// from an always-on ⋯. Component tests run without the theme's CSS, so the
// layout (40px rows, the status never under the ⋯) is checked end to end in
// e2e/tests/phone-sidebar.spec.ts.

const chat: SidebarChat = {
  createdAt: "2026-09-30T12:00:00.000Z",
  id: fixtureId("conversation", 1),
  lastMessageAt: "2026-09-30T12:05:00.000Z",
  myState: { lastReadAt: null },
  pinned: false,
  title: "Browser scout",
  updatedAt: "2026-09-30T12:05:00.000Z",
};

const touch = (enabled: boolean) =>
  cdp().send("Emulation.setTouchEmulationEnabled", {
    enabled,
    maxTouchPoints: 5,
  });

beforeAll(async () => {
  await page.viewport(390, 844);
  await touch(true);
});

afterAll(async () => {
  await touch(false);
  await page.viewport(1336, 800);
});

afterEach(cleanup);

const renderRow = () => {
  const handlers = {
    onArchive: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
  };
  renderWithI18n(
    <ul className="w-72">
      <ChatRow
        active={false}
        attention="unread"
        chat={chat}
        nextRunAt="2026-10-21T08:00:00.000Z"
        {...handlers}
      />
    </ul>
  );
  const row = document.querySelector<HTMLButtonElement>(
    `[data-chat-id="${chat.id}"]`
  ) as HTMLButtonElement;
  return { handlers, row };
};

describe("ChatRow on a phone", () => {
  it("is coarse-pointer in this frame", () => {
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  });

  it("keeps the status at the row's end and the actions reachable", () => {
    const { row } = renderRow();
    expect(row.querySelector("[data-attention=unread]")).not.toBeNull();
    // Hidden from the finger, but still there for a screen reader.
    expect(
      screen.getByRole("button", { name: "Actions for Browser scout" })
    ).toBeTruthy();
  });

  it("opens the actions on a long press, without opening the chat", async () => {
    vi.useFakeTimers();
    try {
      const { handlers, row } = renderRow();
      fireEvent.pointerDown(row, {
        clientX: 10,
        clientY: 10,
        pointerType: "touch",
      });
      vi.advanceTimersByTime(600);
      fireEvent.pointerUp(row, { pointerType: "touch" });
      fireEvent.click(row);
      expect(handlers.onSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    expect(
      await screen.findByRole("menuitem", { name: "Rename" })
    ).toBeTruthy();
  });

  it("treats a press that drifts as a scroll, and a tap as opening the chat", () => {
    vi.useFakeTimers();
    try {
      const { handlers, row } = renderRow();
      fireEvent.pointerDown(row, {
        clientX: 10,
        clientY: 10,
        pointerType: "touch",
      });
      fireEvent.pointerMove(row, {
        clientX: 10,
        clientY: 40,
        pointerType: "touch",
      });
      vi.advanceTimersByTime(600);
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
      fireEvent.click(row);
      expect(handlers.onSelect).toHaveBeenCalledWith(chat.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the actions on a context menu (Android's long press)", async () => {
    const { row } = renderRow();
    fireEvent.contextMenu(row);
    expect(
      await screen.findByRole("menuitem", { name: "Archive" })
    ).toBeTruthy();
  });
});
