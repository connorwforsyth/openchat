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
import {
  canvasColorReader,
  captureSlide,
  type ReadColor,
} from "./slide-capture";
import type { SlideLayout } from "./slide-layout";
import { regionRasterizer, slidePicture } from "./slide-raster";
import { failedSlideLayout } from "./slide-rules";

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
  onError: (error: RuntimeError) => void
): Root => {
  const report = (error: unknown) => onError(runtimeError("render", error));
  return createRoot(host, {
    onCaughtError: report,
    onRecoverableError: report,
    onUncaughtError: report,
  });
};

/**
 * What a slide that can't be drawn shows in its place: which slide, and
 * why, at the slide's size, so the rest of the deck still reads in order.
 */
export const slideErrorCard = (
  number: number,
  id: string,
  error: RuntimeError
): HTMLElement => {
  const card = document.createElement("div");
  card.className = "deck-error";
  card.dataset.slideError = id;
  card.setAttribute("role", "alert");
  const heading = document.createElement("strong");
  heading.textContent = `${number} · ${id}`;
  const detail = document.createElement("pre");
  detail.textContent = error.message || error.kind;
  card.append(heading, detail);
  return card;
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
  const frames = deck.slides.map((slide, index) => {
    const frame = document.createElement("div");
    frame.className = "deck-slide";
    frame.dataset.slide = slide.id;
    const canvas = document.createElement("div");
    canvas.className = "deck-canvas";
    frame.append(canvas);
    root.append(frame);
    // A slide that throws while drawing shows why in its place, as one that
    // didn't compile does; React has already given up on its tree.
    const failed = (error: RuntimeError) => {
      const drawn = frame.querySelector(".deck-canvas");
      if (!drawn) {
        return;
      }
      drawn.replaceWith(slideErrorCard(index + 1, slide.id, error));
      onError(slideError(slide, error));
    };
    if (slide.element.ok) {
      const slideReact = slideRoot(canvas, (error) =>
        queueMicrotask(() => failed(error))
      );
      roots.push(slideReact);
      const { value } = slide.element;
      flushSync(() => slideReact.render(value));
    } else {
      failed(slide.element.error);
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

  /** The theme's colours for a slide that failed: the error card's. */
  const failedColors = (readColor: ReadColor) => {
    const token = (name: string) =>
      readColor(
        getComputedStyle(document.documentElement)
          .getPropertyValue(`--${name}`)
          .trim()
      );
    const ink = { a: 1, b: 0, g: 0, r: 0 };
    return {
      background: token("muted"),
      foreground: token("destructive") ?? ink,
      muted: token("muted-foreground") ?? ink,
    };
  };

  /** One slide drawn at full size in `host` and read back for `format`. */
  const exportSlide = async (
    slide: LoadedSlide,
    index: number,
    host: HTMLElement,
    { format, readColor }: { format: ExportFormat; readColor: ReadColor }
  ): Promise<{ page: SlideLayout; root: Root | null }> => {
    let failure = slide.element.ok ? null : slide.element.error;
    let slideReact: Root | null = null;
    if (slide.element.ok) {
      slideReact = slideRoot(host, (error) => {
        failure ??= error;
      });
      const { value } = slide.element;
      flushSync(() => slideReact?.render(value));
      await picturesLoaded(host);
    }
    const notes = notesOf(
      slide.notes,
      [...host.querySelectorAll("[data-notes]")].map(
        (each) => each.textContent ?? ""
      )
    );
    if (failure) {
      const failed = failedSlideLayout(
        {
          id: slide.id,
          message: failure.message || failure.kind,
          notes,
          number: index + 1,
        },
        failedColors(readColor)
      );
      return { page: failed, root: slideReact };
    }
    const captured = withBackground(
      await captureSlide(host, notes, {
        rasterize: format === "pptx" ? regionRasterizer(host) : null,
        readColor,
      })
    );
    if (format === "pptx") {
      return { page: captured, root: slideReact };
    }
    const picture = await slidePicture(host).catch((error: unknown) => {
      // The page is still drawn, from its shapes and text.
      console.warn(`slide "${slide.id}" couldn't be pictured`, error);
      return null;
    });
    return { page: { ...captured, picture }, root: slideReact };
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
      for (const [index, slide] of deck.slides.entries()) {
        const host = document.createElement("div");
        host.style.width = `${WIDTH}px`;
        host.style.height = `${HEIGHT}px`;
        host.style.overflow = "hidden";
        capture.append(host);
        // biome-ignore lint/performance/noAwaitInLoops: one slide drawn and read at a time keeps the page light.
        const { page, root: drawn } = await exportSlide(slide, index, host, {
          format,
          readColor,
        });
        if (drawn) {
          captureRoots.push(drawn);
        }
        layouts.push(page);
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
