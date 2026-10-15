import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import {
  PresentationPreview,
  presentationFileName,
  presentKeyAction,
} from "./presentation-preview";
import { RUNTIME_CHANNEL } from "./runtime-protocol";

// A deck in the panel (164). Nothing listens at the runtime's address, so
// the frame never loads: what "the runtime" says is dispatched by hand,
// and what the panel asks of it is read off the frame's `postMessage`.

const RUNTIME = "http://127.0.0.1:9";
const PREVIEW = /Preview of/;

const frame = () => screen.getByTitle<HTMLIFrameElement>(PREVIEW);

const fromFrame = (data: object) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: RUNTIME_CHANNEL, ...data },
      origin: "null",
      source: frame().contentWindow,
    })
  );

const position = (slide: number, notes = "") => ({
  id: "1",
  notes,
  presenting: true,
  slide,
  slides: 3,
  step: 0,
  steps: 0,
  type: "position",
});

/** The panel's messages to the frame, by type. */
const sent = (spy: ReturnType<typeof vi.fn>, type: string) =>
  spy.mock.calls
    .map(([, message]) => message as { type: string })
    .filter((message) => message.type === type);

const ready = async (spy: ReturnType<typeof vi.fn>) => {
  fromFrame({ type: "ready" });
  await waitFor(() => expect(sent(spy, "render")).toHaveLength(1));
  fromFrame({ ...position(0), presenting: false });
};

afterEach(cleanup);

describe("presentKeyAction", () => {
  it("steps with the arrows, space and paging keys, jumps with Home and End", () => {
    expect(
      ["ArrowRight", "ArrowDown", "PageDown", " "].map(presentKeyAction)
    ).toEqual(["next", "next", "next", "next"]);
    expect(["ArrowLeft", "PageUp"].map(presentKeyAction)).toEqual([
      "previous",
      "previous",
    ]);
    expect(presentKeyAction("Home")).toBe("first");
    expect(presentKeyAction("End")).toBe("last");
    expect(presentKeyAction("Escape")).toBe("close");
    expect(presentKeyAction("n")).toBe("notes");
    expect(presentKeyAction("a")).toBeNull();
  });
});

describe("presentationFileName", () => {
  it("names the file after the deck", () => {
    expect(presentationFileName("Q3 review", "pptx")).toBe("Q3-review.pptx");
    expect(presentationFileName("", "pdf")).toBe("artifact.pdf");
  });
});

describe("PresentationPreview", () => {
  const props = {
    content: '{"title":"Deck","slides":[]}',
    runtimeOrigin: RUNTIME,
    title: "Deck",
  };

  it("renders the deck in the runtime as a presentation, sandboxed", async () => {
    const spy = vi.fn();
    renderWithI18n(<PresentationPreview {...props} post={spy} />);
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts");
    expect(new URL(frame().src).origin).toBe(RUNTIME);
    await ready(spy);
    expect(sent(spy, "render")[0]).toMatchObject({
      code: props.content,
      kind: "presentation",
    });
    expect(await screen.findByText("3 slides")).toBeTruthy();
  });

  it("presents over the window, steps from the keyboard, shows notes, and exits on Escape", async () => {
    const spy = vi.fn();
    renderWithI18n(<PresentationPreview {...props} post={spy} />);
    await ready(spy);
    await userEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(
      screen.getByRole("dialog", { name: "Presenting Deck" })
    ).toBeTruthy();
    expect(
      sent(spy, "present").map((each) => (each as { action?: string }).action)
    ).toEqual(["enter", "first"]);
    fromFrame(position(1, "Say hello"));
    await waitFor(() => expect(screen.getByText("Slide 2 of 3")).toBeTruthy());
    expect(screen.getByLabelText("Speaker notes").textContent).toBe(
      "Say hello"
    );
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowLeft}");
    expect(
      sent(spy, "present")
        .slice(2)
        .map((each) => (each as { action?: string }).action)
    ).toEqual(["next", "previous"]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent(spy, "present").at(-1)).toMatchObject({ action: "exit" });
  });

  it("downloads the file the runtime exports", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const spy = vi.fn();
    renderWithI18n(<PresentationPreview {...props} post={spy} />);
    await ready(spy);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "PowerPoint (.pptx)" })
    );
    const [request] = sent(spy, "export") as { request?: string }[];
    expect(request).toMatchObject({ format: "pptx" });
    fromFrame({
      data: new Uint8Array([80, 75]),
      format: "pptx",
      id: "1",
      request: request?.request,
      type: "exported",
    });
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    const blob = created.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    created.mockRestore();
  });
});
