import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../../testing/render";
import { EditorShell, EditorToolbar } from "./editor-shell";
import { NotesDrawer } from "./notes-drawer";
import {
  defaultEditorPanels,
  EDITOR_PANELS_STORAGE_KEY,
  parseEditorPanels,
  toggleEditorPanel,
} from "./panels";

// The store reads storage when the first editor mounts.
beforeEach(() =>
  window.localStorage.setItem(
    EDITOR_PANELS_STORAGE_KEY,
    JSON.stringify(defaultEditorPanels)
  )
);
afterEach(cleanup);

const shell = ({
  covered = false,
  inspector = null,
  width = 1000,
}: {
  readonly covered?: boolean;
  readonly inspector?: string | null;
  readonly width?: number;
} = {}) =>
  renderWithI18n(
    <div style={{ height: 600, width }}>
      <EditorShell
        canvas={<div>The slide</div>}
        covered={covered}
        inspector={inspector ? <div>{inspector}</div> : null}
        inspectorPlaceholder={<div>Pick something</div>}
        notes={
          <NotesDrawer
            label="Speaker notes"
            onCommit={vi.fn()}
            placeholder="What to say"
            readOnly={false}
            value=""
          />
        }
        rail={<div>Thumbnails rail</div>}
        toolbar={
          <EditorToolbar
            canRedo={false}
            canUndo={false}
            onRedo={vi.fn()}
            onUndo={vi.fn()}
          />
        }
      />
    </div>
  );

const toggle = (name: string) => screen.getByRole("button", { name });

describe("parseEditorPanels", () => {
  it("shows every panel unless told otherwise", () => {
    expect(parseEditorPanels(null)).toEqual(defaultEditorPanels);
    expect(parseEditorPanels("not json")).toEqual(defaultEditorPanels);
    expect(parseEditorPanels('{"rail":false,"notes":"no"}')).toEqual({
      ...defaultEditorPanels,
      rail: false,
    });
  });

  it("toggles one panel and leaves the rest", () => {
    expect(toggleEditorPanel(defaultEditorPanels, "inspector")).toEqual({
      ...defaultEditorPanels,
      inspector: false,
    });
  });
});

describe("EditorShell's panels", () => {
  it("docks the inspector beside the canvas, waiting for a pick", async () => {
    shell();
    expect(await screen.findByText("Pick something")).toBeTruthy();
    const aside = screen.getByText("Pick something").closest("aside");
    expect(aside?.className).not.toContain("absolute");
  });

  it("hides and shows each panel from the toolbar, and remembers it", async () => {
    shell();
    for (const name of ["Thumbnails", "Inspector", "Notes"]) {
      expect(toggle(name).getAttribute("aria-pressed")).toBe("true");
    }
    await userEvent.click(toggle("Thumbnails"));
    await userEvent.click(toggle("Inspector"));
    await userEvent.click(toggle("Notes"));
    expect(screen.queryByText("Thumbnails rail")).toBeNull();
    expect(screen.queryByText("Pick something")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Speaker notes" })).toBeNull();
    expect(toggle("Thumbnails").getAttribute("aria-pressed")).toBe("false");
    expect(
      parseEditorPanels(window.localStorage.getItem(EDITOR_PANELS_STORAGE_KEY))
    ).toEqual({ inspector: false, notes: false, rail: false });

    // A reload starts from what was stored.
    cleanup();
    window.localStorage.setItem(
      EDITOR_PANELS_STORAGE_KEY,
      JSON.stringify({ inspector: true, notes: false, rail: false })
    );
    shell();
    expect(await screen.findByText("Pick something")).toBeTruthy();
    expect(screen.queryByText("Thumbnails rail")).toBeNull();
  });

  it("toggles the panels by key, outside text fields", async () => {
    shell();
    await userEvent.keyboard("t");
    expect(screen.queryByText("Thumbnails rail")).toBeNull();
    await userEvent.keyboard("i");
    expect(screen.queryByText("Pick something")).toBeNull();
    await userEvent.keyboard("{Shift>}N{/Shift}");
    expect(screen.queryByRole("textbox", { name: "Speaker notes" })).toBeNull();
    await userEvent.keyboard("t");
    expect(screen.getByText("Thumbnails rail")).toBeTruthy();
  });

  it("hides the notes from their own header", async () => {
    shell();
    await userEvent.click(screen.getByRole("button", { name: "Hide notes" }));
    expect(screen.queryByRole("textbox", { name: "Speaker notes" })).toBeNull();
    expect(toggle("Notes").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(toggle("Notes"));
  });

  it("leaves the panels alone while the canvas covers the window", async () => {
    shell({ covered: true });
    await userEvent.keyboard("t");
    expect(screen.getByText("Thumbnails rail")).toBeTruthy();
  });

  it("lays the inspector over the canvas in a narrow pane, only for a pick", async () => {
    shell({ width: 600 });
    await vi.waitFor(() =>
      expect(
        document
          .querySelector("[data-artifact-editor]")
          ?.getAttribute("data-width")
      ).toBe("medium")
    );
    expect(screen.queryByText("Pick something")).toBeNull();
    cleanup();
    shell({ inspector: "Title", width: 600 });
    const aside = (await screen.findByText("Title")).closest("aside");
    expect(aside?.className).toContain("absolute");
  });
});
