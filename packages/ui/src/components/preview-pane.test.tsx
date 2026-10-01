import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Command } from "cmdk";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PreviewPane,
  PreviewPaneContent,
  PreviewPaneList,
  usePreviewPane,
} from "./preview-pane";

// The pane follows the list's active item, whichever way it moved: arrow
// keys or the pointer (Base UI's PreviewCard only follows hover).

afterEach(cleanup);

const ITEMS = ["alpha", "beta", "gamma"] as const;
const OUTSIDE = /inside <PreviewPane>/;

function BoundList() {
  const { bind } = usePreviewPane();
  return (
    <Command label="Things" {...bind}>
      <Command.Input aria-label="Search" />
      <Command.List>
        {ITEMS.map((item) => (
          <Command.Item key={item} value={item}>
            {item}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}

const card = () =>
  document.querySelector<HTMLElement>("[data-slot=preview-pane-content]");

describe("PreviewPane", () => {
  it("follows the active item by keyboard", async () => {
    render(
      <PreviewPane defaultValue="alpha">
        <PreviewPaneList>
          <BoundList />
        </PreviewPaneList>
        <PreviewPaneContent>{(value) => `About ${value}`}</PreviewPaneContent>
      </PreviewPane>
    );
    expect(card()?.textContent).toBe("About alpha");
    const input = screen.getByLabelText("Search");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(await screen.findByText("About beta")).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(await screen.findByText("About gamma")).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(await screen.findByText("About beta")).toBeTruthy();
  });

  it("follows the active item by pointer", async () => {
    render(
      <PreviewPane defaultValue="alpha">
        <BoundList />
        <PreviewPaneContent>{(value) => `About ${value}`}</PreviewPaneContent>
      </PreviewPane>
    );
    fireEvent.pointerMove(screen.getByRole("option", { name: "gamma" }));
    expect(await screen.findByText("About gamma")).toBeTruthy();
    expect(card()?.dataset.value).toBe("gamma");
  });

  it("can be controlled, and tells the caller what's active", async () => {
    const seen = vi.fn();
    function Controlled() {
      const [value, setValue] = useState("beta");
      const change = useCallback((next: string) => {
        seen(next);
        setValue(next);
      }, []);
      return (
        <PreviewPane onValueChange={change} value={value}>
          <BoundList />
          <PreviewPaneContent>
            {(active) => `About ${active}`}
          </PreviewPaneContent>
        </PreviewPane>
      );
    }
    render(<Controlled />);
    expect(card()?.textContent).toBe("About beta");
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "ArrowDown" });
    expect(await screen.findByText("About gamma")).toBeTruthy();
    expect(seen).toHaveBeenLastCalledWith("gamma");
  });

  it("shows no card when nothing is active or there's nothing to say", () => {
    const { rerender } = render(
      <PreviewPane>
        <PreviewPaneContent>{(value) => `About ${value}`}</PreviewPaneContent>
      </PreviewPane>
    );
    expect(card()).toBeNull();
    rerender(
      <PreviewPane value="beta">
        <PreviewPaneContent>
          {(value) => (value === "beta" ? null : value)}
        </PreviewPaneContent>
      </PreviewPane>
    );
    expect(card()).toBeNull();
  });

  it("puts the card beside the list, or below it on a narrow screen", () => {
    render(
      <PreviewPane value="alpha">
        <PreviewPaneList>list</PreviewPaneList>
        <PreviewPaneContent>{() => "card"}</PreviewPaneContent>
      </PreviewPane>
    );
    const pane = document.querySelector<HTMLElement>(
      "[data-slot=preview-pane]"
    );
    // Tailwind isn't compiled for these tests, so check the utilities:
    // stacked by default, side by side from `sm` (640px).
    expect(pane?.className.split(" ")).toEqual(
      expect.arrayContaining(["flex-col", "sm:flex-row", "sm:items-start"])
    );
    expect(card()?.className.split(" ")).toEqual(
      expect.arrayContaining(["w-full", "sm:w-60"])
    );
  });

  it("refuses to bind outside a pane", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<BoundList />)).toThrow(OUTSIDE);
    spy.mockRestore();
  });
});
