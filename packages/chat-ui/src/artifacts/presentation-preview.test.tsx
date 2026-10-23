import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import {
  deckProblem,
  PresentationPreview,
  presentationFileName,
  presentKeyAction,
  RUNTIME_READY_TIMEOUT_MS,
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

  it("says the artifacts service isn't set up, rather than showing the code", () => {
    renderWithI18n(<PresentationPreview {...props} runtimeOrigin={null} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Preview unavailable: the artifacts service isn't set up here"
    );
    expect(screen.queryByTitle(PREVIEW)).toBeNull();
  });

  it("says the artifacts service isn't running when the frame never answers, and recovers if it does", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    renderWithI18n(<PresentationPreview {...props} post={spy} />);
    await vi.advanceTimersByTimeAsync(RUNTIME_READY_TIMEOUT_MS + 1);
    vi.useRealTimers();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Preview unavailable: the artifacts service isn't running"
    );
    expect(alert.textContent).toContain(RUNTIME);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    await ready(spy);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("lists every slide that failed, and keeps the deck", async () => {
    const spy = vi.fn();
    renderWithI18n(<PresentationPreview {...props} post={spy} />);
    await ready(spy);
    for (const id of ["two", "five"]) {
      fromFrame({
        error: { kind: "syntax", message: `slide "${id}": Unexpected token` },
        id: "1",
        type: "error",
      });
    }
    const alert = await screen.findByRole("alert");
    await waitFor(() =>
      expect(alert.textContent).toContain(
        "2 slides couldn't be drawn. The others are below."
      )
    );
    expect(alert.textContent).toContain("five: Unexpected token");
    expect(frame()).toBeTruthy();
  });
});

describe("deckProblem", () => {
  it("tells a slide's error from the deck's", () => {
    expect(
      deckProblem({ kind: "render", message: 'slide "intro": boom' })
    ).toEqual({ id: "intro", kind: "slide", message: "boom" });
    expect(deckProblem({ kind: "syntax", message: "isn't JSON" })).toEqual({
      kind: "deck",
      message: "isn't JSON",
    });
  });
});
