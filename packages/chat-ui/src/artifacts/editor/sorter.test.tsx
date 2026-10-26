import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../../testing/render";
import { dropIndex, moveTarget, Sorter, type SorterProps } from "./sorter";

afterEach(cleanup);

const ROW_ACTIONS = /Actions for/;

const ITEMS = [
  { id: "intro", label: "Slide 1" },
  { id: "plan", label: "Slide 2" },
  { id: "close", label: "Slide 3" },
];

const thumbnail = (item: { readonly id: string }) => <span>{item.id}</span>;

const sorter = (props: Partial<SorterProps> = {}) => {
  const handlers = {
    onAdd: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onMove: vi.fn(),
    onSelect: vi.fn(),
  };
  renderWithI18n(
    <Sorter
      addLabel="Add slide"
      canEdit
      items={ITEMS}
      label="Slides"
      selected="intro"
      thumbnail={thumbnail}
      {...handlers}
      {...props}
    />
  );
  return handlers;
};

describe("dropIndex and moveTarget", () => {
  it("drop before the row under the pointer's top half, after its bottom half", () => {
    const box = { height: 100, top: 200 };
    expect(dropIndex(2, 230, box)).toBe(2);
    expect(dropIndex(2, 290, box)).toBe(3);
  });

  it("count the slot a dragged row leaves", () => {
    expect(moveTarget(0, 3)).toBe(2);
    expect(moveTarget(2, 0)).toBe(0);
  });
});

describe("Sorter", () => {
  it("picks a row, and walks the rows with the arrows", async () => {
    const { onSelect } = sorter();
    await userEvent.click(screen.getByRole("button", { name: "Slide 2" }));
    expect(onSelect).toHaveBeenLastCalledWith("plan");
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith("close");
  });

  it("moves the focused row with Alt and an arrow", async () => {
    const { onMove } = sorter();
    screen.getByRole("button", { name: "Slide 1" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(onMove).toHaveBeenCalledWith("intro", 1);
  });

  it("adds, duplicates and deletes through its buttons", async () => {
    const { onAdd, onDelete, onDuplicate } = sorter();
    await userEvent.click(screen.getByRole("button", { name: "Add slide" }));
    expect(onAdd).toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for 2" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledWith("plan");
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for 3" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("close");
  });

  it("only picks when it can't edit", () => {
    sorter({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Add slide" })).toBeNull();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).toBeNull();
  });
});
