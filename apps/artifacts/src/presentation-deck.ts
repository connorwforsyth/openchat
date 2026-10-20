import type {
  ExportFormat,
  PresentAction,
  RuntimeError,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { runtimeError } from "./errors";
import {
  type DeckPosition,
  type LoadedDeck,
  type LoadedSlide,
  nextPosition,
  notesOf,
  START,
} from "./presentation";
import { canvasColorReader, captureSlide } from "./slide-capture";
import type { SlideLayout } from "./slide-layout";

// A deck on the runtime page (164). Every slide is drawn at its full
// 1920×1080 and scaled to fit (CSS `transform`, so it's crisp at any size):
// down the page in the overview, or one at a time, fitted to the window,
// while presenting. Each slide is its own React root, so one that throws
// is that slide's error and the others still draw. Nothing animates (D28):
// the presenter drives it from the keyboard.

const WIDTH = 1920;
const HEIGHT = 1080;

/** Where the presenter is, as the host shows it. */
export interface DeckReport {
  readonly notes: string;
  readonly presenting: boolean;
  readonly slide: number;
  readonly slides: number;
  readonly step: number;
  readonly steps: number;
}

export interface DeckController {
  readonly control: (action: PresentAction) => void;
  /** The deck as a file, drawn afresh with every step showing. */
  readonly exportAs: (format: ExportFormat) => Promise<Uint8Array>;
  readonly teardown: () => void;
}

const slideError = (slide: LoadedSlide, error: RuntimeError): RuntimeError => ({
  ...error,
  message: `slide "${slide.id}": ${error.message}`,
});

/** A React root for one slide; its errors go to `onError`. */
const slideRoot = (
  host: HTMLElement,
  slide: LoadedSlide,
  onError: (error: RuntimeError) => void
): Root => {
  const report = (error: unknown) =>
    onError(slideError(slide, runtimeError("render", error)));
  return createRoot(host, {
    onCaughtError: report,
    onRecoverableError: report,
    onUncaughtError: report,
  });
};

/** Waits for a slide's pictures, so a capture sees them drawn. */
const picturesLoaded = (host: HTMLElement): Promise<unknown> =>
  Promise.all(
    [...host.querySelectorAll("img")].map((image) =>
      image.decode().catch(() => undefined)
    )
  );

/**
 * A full-canvas painted box first is the slide's background: PowerPoint and
 * PDF draw it as the page's, not as a shape on top. Pure.
 */
export const withBackground = (layout: SlideLayout): SlideLayout => {
  const [first, ...rest] = layout.items;
  const covers =
    first?.type === "shape" &&
    first.fill !== null &&
    first.fill.a === 1 &&
    Math.abs(first.x) < 1 &&
    Math.abs(first.y) < 1 &&
    first.w >= WIDTH - 1 &&
    first.h >= HEIGHT - 1;
  return covers && layout.background === null && first.type === "shape"
    ? { ...layout, background: first.fill, items: rest }
    : layout;
};

export const mountDeck = (
  container: HTMLElement,
  deck: LoadedDeck,
  {
    css,
    onError,
    onPosition,
  }: {
    readonly css: string;
    readonly onError: (error: RuntimeError) => void;
    readonly onPosition: (report: DeckReport) => void;
  }
): DeckController => {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "deck";
  container.append(style, root);

  const roots: Root[] = [];
  const frames = deck.slides.map((slide) => {
    const frame = document.createElement("div");
    frame.className = "deck-slide";
    frame.dataset.slide = slide.id;
    const canvas = document.createElement("div");
    canvas.className = "deck-canvas";
    frame.append(canvas);
    root.append(frame);
    if (slide.element.ok) {
      const slideReact = slideRoot(canvas, slide, onError);
      roots.push(slideReact);
      const { value } = slide.element;
      flushSync(() => slideReact.render(value));
    } else {
      const message = document.createElement("p");
      message.className = "deck-error";
      message.textContent = `${slide.id}: ${slide.element.error.message || slide.element.error.kind}`;
      canvas.replaceWith(message);
      onError(slideError(slide, slide.element.error));
    }
    return frame;
  });

  let position: DeckPosition = START;
  let presenting = false;

  const stepsIn = (frame: HTMLElement | undefined): HTMLElement[] =>
    frame ? [...frame.querySelectorAll<HTMLElement>("[data-step]")] : [];

  const layout = () => {
    const scale = Math.min(
      window.innerWidth / WIDTH,
      window.innerHeight / HEIGHT
    );
    frames.forEach((frame, index) => {
      const current = presenting && index === position.slide;
      frame.style.width = current ? `${WIDTH * scale}px` : "";
      frame.style.height = current ? `${HEIGHT * scale}px` : "";
      const fit = current ? scale : frame.clientWidth / WIDTH;
      const canvas = frame.querySelector<HTMLElement>(".deck-canvas");
      if (canvas) {
        canvas.style.transform = `scale(${fit})`;
      }
    });
  };

  const show = () => {
    frames.forEach((frame, index) => {
      frame.toggleAttribute("data-current", index === position.slide);
      stepsIn(frame).forEach((step, at) => {
        step.toggleAttribute(
          "data-step-hidden",
          presenting && index === position.slide && at >= position.step
        );
      });
    });
    root.toggleAttribute("data-presenting", presenting);
    layout();
    const shown = frames[position.slide];
    const slide = deck.slides[position.slide];
    onPosition({
      notes: notesOf(
        slide?.notes ?? "",
        shown
          ? [...shown.querySelectorAll("[data-notes]")].map(
              (each) => each.textContent ?? ""
            )
          : []
      ),
      presenting,
      slide: position.slide,
      slides: frames.length,
      step: position.step,
      steps: stepsIn(shown).length,
    });
  };

  const observer = new ResizeObserver(layout);
  observer.observe(root);
  window.addEventListener("resize", layout);
  show();

  const control = (action: PresentAction) => {
    if (action === "enter") {
      presenting = true;
    } else if (action === "exit") {
      presenting = false;
    }
    position = nextPosition(
      position,
      action,
      frames.map((frame) => stepsIn(frame).length)
    );
    show();
  };

  const exportAs = async (format: ExportFormat): Promise<Uint8Array> => {
    const capture = document.createElement("div");
    capture.className = "deck-capture";
    capture.setAttribute("aria-hidden", "true");
    container.append(capture);
    const captureRoots: Root[] = [];
    try {
      const readColor = canvasColorReader();
      const layouts: SlideLayout[] = [];
      for (const slide of deck.slides) {
        const host = document.createElement("div");
        host.style.width = `${WIDTH}px`;
        host.style.height = `${HEIGHT}px`;
        host.style.overflow = "hidden";
        capture.append(host);
        if (slide.element.ok) {
          const slideReact = slideRoot(host, slide, () => undefined);
          captureRoots.push(slideReact);
          const { value } = slide.element;
          flushSync(() => slideReact.render(value));
          // biome-ignore lint/performance/noAwaitInLoops: one slide drawn and read at a time keeps the page light.
          await picturesLoaded(host);
        }
        const notes = notesOf(
          slide.notes,
          [...host.querySelectorAll("[data-notes]")].map(
            (each) => each.textContent ?? ""
          )
        );
        layouts.push(
          withBackground(await captureSlide(host, notes, readColor))
        );
      }
      const { writePdf, writePptx } = await import("./slide-export");
      const layoutDeck = { slides: layouts, title: deck.title };
      return format === "pptx" ? writePptx(layoutDeck) : writePdf(layoutDeck);
    } finally {
      for (const each of captureRoots) {
        each.unmount();
      }
      capture.remove();
    }
  };

  return {
    control,
    exportAs,
    teardown: () => {
      observer.disconnect();
      window.removeEventListener("resize", layout);
      for (const each of roots) {
        each.unmount();
      }
    },
  };
};
