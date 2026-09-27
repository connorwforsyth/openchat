import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithI18n } from "../testing/render";
import { ArtifactPreview, type ArtifactPreviewProps } from "./artifact-preview";
import { RUNTIME_CHANNEL } from "./runtime-protocol";

// Nothing listens here, so the frame never loads: messages from "the
// runtime" are dispatched by hand, from the frame's window.
const RUNTIME = "http://127.0.0.1:9";
const PREVIEW = /Preview of/;
const NEEDS_RUNTIME = /need the artifact runtime/;
const NOT_RESPONDING = /isn't responding/;
const SYNTAX = /syntax error/;
const IMPORT = /can't import "canvas-confetti"/;

const props: ArtifactPreviewProps = {
  content: "<!doctype html><p>hi</p>",
  fileName: "page.html",
  kind: "html",
  runtimeOrigin: null,
  title: "Page",
};

const frame = () => screen.getByTitle<HTMLIFrameElement>(PREVIEW);

const fromFrame = (data: unknown, source = frame().contentWindow) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: RUNTIME_CHANNEL, ...(data as object) },
      origin: "null",
      source,
    })
  );

/** Lets the panel post its render after `ready` (an effect, next commit). */
const settle = () => new Promise((resolve) => window.setTimeout(resolve, 20));

afterEach(cleanup);

describe("ArtifactPreview without a runtime", () => {
  it("renders HTML in a sandboxed srcdoc frame", () => {
    renderWithI18n(<ArtifactPreview {...props} />);
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame().getAttribute("srcdoc")).toBe(props.content);
    expect(frame().hasAttribute("src")).toBe(false);
  });

  it("wraps SVG in a document", () => {
    renderWithI18n(
      <ArtifactPreview {...props} content="<svg></svg>" kind="svg" />
    );
    expect(frame().getAttribute("srcdoc")).toContain("<body");
  });

  it("says React and Mermaid need the runtime instead of rendering", () => {
    renderWithI18n(<ArtifactPreview {...props} kind="react" />);
    expect(screen.getByText(NEEDS_RUNTIME)).toBeTruthy();
    expect(screen.queryByTitle(PREVIEW)).toBeNull();
  });
});

describe("ArtifactPreview with a runtime", () => {
  it("loads the runtime origin, sandboxed, told who its parent is", () => {
    renderWithI18n(<ArtifactPreview {...props} runtimeOrigin={RUNTIME} />);
    const url = new URL(frame().src);
    expect(url.origin).toBe(RUNTIME);
    expect(url.searchParams.get("parent")).toBe(window.location.origin);
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame().hasAttribute("srcdoc")).toBe(false);
  });

  it("shows the runtime's errors for the current render only", async () => {
    renderWithI18n(
      <ArtifactPreview {...props} kind="react" runtimeOrigin={RUNTIME} />
    );
    fromFrame({ type: "ready" });
    await settle();
    // The render posted on `ready` is id 1; anything else is stale.
    fromFrame({
      error: { kind: "render", message: "stale" },
      id: "0",
      type: "error",
    });
    fromFrame({
      error: { kind: "syntax", message: "Unexpected token (1:19)" },
      id: "1",
      type: "error",
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(SYNTAX);
    expect(alert.textContent).toContain("Unexpected token (1:19)");
    expect(alert.textContent).not.toContain("stale");
  });

  it("words import errors itself", async () => {
    renderWithI18n(
      <ArtifactPreview {...props} kind="react" runtimeOrigin={RUNTIME} />
    );
    fromFrame({ type: "ready" });
    await settle();
    fromFrame({
      error: { kind: "import", message: "canvas-confetti" },
      id: "1",
      type: "error",
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(IMPORT);
  });

  it("ignores messages that don't come from its frame", async () => {
    renderWithI18n(
      <ArtifactPreview {...props} kind="react" runtimeOrigin={RUNTIME} />
    );
    fromFrame({ type: "ready" });
    await settle();
    fromFrame(
      { error: { kind: "render", message: "x" }, id: "1", type: "error" },
      window
    );
    fromFrame({ height: 480, type: "resize" }, window);
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(frame().style.height).toBe("");
  });

  it("sizes the frame to the content height it reports", async () => {
    renderWithI18n(<ArtifactPreview {...props} runtimeOrigin={RUNTIME} />);
    fromFrame({ height: 480, type: "resize" });
    await waitFor(() => expect(frame().style.height).toBe("480px"));
  });

  it("falls back to srcdoc for HTML when the runtime never answers", async () => {
    renderWithI18n(
      <ArtifactPreview {...props} readyTimeoutMs={20} runtimeOrigin={RUNTIME} />
    );
    await waitFor(() =>
      expect(frame().getAttribute("srcdoc")).toBe(props.content)
    );
  });

  it("says so for React when the runtime never answers", async () => {
    renderWithI18n(
      <ArtifactPreview
        {...props}
        kind="react"
        readyTimeoutMs={20}
        runtimeOrigin={RUNTIME}
      />
    );
    expect(await screen.findByText(NOT_RESPONDING)).toBeTruthy();
  });

  it("doesn't fall back once the runtime is ready", async () => {
    renderWithI18n(
      <ArtifactPreview {...props} readyTimeoutMs={40} runtimeOrigin={RUNTIME} />
    );
    fromFrame({ type: "ready" });
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    expect(frame().hasAttribute("srcdoc")).toBe(false);
  });
});
