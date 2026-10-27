import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { AnnotationsData } from "@workspace/ai/messages/annotations";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { artifactPage, artifactVersions } from "../../fixtures";
import { renderWithI18n } from "../../testing/render";
import { Annotatable } from "./annotate-layer";
import { type AnnotateSink, AnnotateSinkProvider } from "./sink";

// The tests load no Tailwind: these are the few utilities the layer's
// placement rests on.
beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = `
    .relative { position: relative }
    .absolute { position: absolute }
    .inset-0 { inset: 0 }
    .inset-x-0 { left: 0; right: 0 }
    .bottom-0 { bottom: 0 }
    .pointer-events-none { pointer-events: none }
    .pointer-events-auto { pointer-events: auto }
    .flex { display: flex }
    .flex-col { flex-direction: column }
    .flex-1 { flex: 1 1 0% }
    .h-full { height: 100% }`;
  document.head.append(style);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const versions = artifactVersions[artifactPage.id];
const AREA = /Annotation area/;
const FIRST_NOTE = /^Note 1/;

const header = (content: ReactNode) => (
  <div data-testid="header" style={{ display: "flex", height: 48 }}>
    {content}
  </div>
);

// A document-like view: the layer reads the passage under a mark.
const view = (frame: (content: ReactNode) => ReactNode) => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    {frame(<h3 style={{ flex: 1 }}>Benchmark</h3>)}
    <div className="ProseMirror" style={{ flex: 1, padding: 24 }}>
      <h2>Intro</h2>
      <p data-testid="passage" style={{ fontSize: 24 }}>
        We sell otters.
      </p>
    </div>
  </div>
);

const renderLayer = (sink: AnnotateSink | null) =>
  renderWithI18n(
    <AnnotateSinkProvider value={sink}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: 480,
          width: 720,
        }}
      >
        <Annotatable
          artifact={artifactPage}
          header={header}
          versions={versions}
        >
          {view}
        </Annotatable>
      </div>
    </AnnotateSinkProvider>
  );

const sinkOf = (mode: AnnotateSink["mode"] = "send") => {
  const sent: AnnotationsData[] = [];
  const sink: AnnotateSink = {
    mode,
    send: vi.fn((data: AnnotationsData) => {
      sent.push(data);
      return Promise.resolve();
    }),
  };
  return { sent, sink };
};

const surface = () => screen.getByRole("application", { name: AREA });

/** Clicks the surface over the middle of `element`, as a person would. */
const clickOver = async (element: Element) => {
  const area = surface().getBoundingClientRect();
  const box = element.getBoundingClientRect();
  await userEvent.click(surface(), {
    position: {
      x: box.left + box.width / 4 - area.left,
      y: box.top + box.height / 2 - area.top,
    },
  });
};

describe("Annotate", () => {
  it("isn't offered where nothing can take the notes", () => {
    renderLayer(null);
    expect(screen.queryByRole("button", { name: "Annotate" })).toBeNull();
  });

  it("pins a note on what was clicked and sends it with where it points", async () => {
    const { sent, sink } = sinkOf();
    renderLayer(sink);
    await userEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await clickOver(screen.getByTestId("passage"));

    expect(await screen.findByText("“We sell otters.”")).toBeTruthy();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Note" }),
      "Say sea otters.{Enter}"
    );
    expect(
      screen.getByRole("button", { name: "Note 1: Say sea otters." })
    ).toBeTruthy();
    expect(screen.getByText("1 note")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Send notes" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      artifactId: artifactPage.id,
      kind: "html",
      notes: [
        {
          note: "Say sea otters.",
          target: { section: "Intro", text: "We sell otters.", type: "text" },
          version: 1,
        },
      ],
    });
    // Sent, they're gone from the artifact.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: FIRST_NOTE })).toBeNull()
    );
  });

  it("keeps drafts through a reload", async () => {
    const { sink } = sinkOf();
    const first = renderLayer(sink);
    await userEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await clickOver(screen.getByTestId("passage"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Note" }),
      "Later.{Enter}"
    );
    first.unmount();

    renderLayer(sink);
    expect(screen.getByRole("button", { name: "Note 1: Later." })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Annotate, 1 note" })
    ).toBeTruthy();
  });

  it("works from the keyboard, and Escape stays inside it", async () => {
    const { sink } = sinkOf("steer");
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    renderLayer(sink);
    await userEvent.click(screen.getByRole("button", { name: "Annotate" }));
    surface().focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    const note = screen.getByRole("textbox", { name: "Note" });
    expect(document.activeElement).toBe(note);
    await userEvent.keyboard("Here.");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Steer with notes" })
    ).toBeTruthy();
    surface().focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("application")).toBeNull();
    expect(outside).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" })
    );
    document.removeEventListener("keydown", outside);
  });

  it("drops a note left empty, and removes one on request", async () => {
    const { sink } = sinkOf();
    renderLayer(sink);
    await userEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await clickOver(screen.getByTestId("passage"));
    const note = screen.getByRole("region", { name: "Note 1" });
    await userEvent.click(within(note).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: FIRST_NOTE })).toBeNull();

    await clickOver(screen.getByTestId("passage"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Note" }),
      "Gone soon"
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("button", { name: FIRST_NOTE })).toBeNull();
  });
});
