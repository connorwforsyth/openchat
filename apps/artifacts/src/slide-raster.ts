import { SLIDE_SIZE } from "@workspace/artifacts-kit/kinds/presentation/content";

import type { Rasterize } from "./slide-capture";
import { opaqueBounds } from "./slide-rules";

// Pictures of a drawn slide, through html-to-image (MIT): the whole slide
// for the PDF's pages, and one element's region for what PowerPoint can't
// draw natively. A region is cut from a picture of the whole slide with
// everything but that element hidden, so its ancestors' layout, transforms
// and opacity still apply, and its own painting is all that shows.
// Fonts aren't embedded: slides use the system's, and the runtime's CSP
// blocks the fetches embedding would make.

/** Twice the canvas, so a page stays sharp when zoomed or printed. */
const PIXEL_RATIO = 2;
const PAGE_QUALITY = 0.95;
const ISOLATE = "deck-raster-isolate";
const TARGET = "data-deck-raster-target";

const ISOLATE_CSS = `
.${ISOLATE} * { visibility: hidden !important; }
.${ISOLATE} [${TARGET}], .${ISOLATE} [${TARGET}] * { visibility: visible !important; }
`;

const drawSlide = async (host: HTMLElement): Promise<HTMLCanvasElement> => {
  const { toCanvas } = await import("html-to-image");
  return toCanvas(host, {
    height: SLIDE_SIZE.height,
    pixelRatio: PIXEL_RATIO,
    skipAutoScale: true,
    skipFonts: true,
    width: SLIDE_SIZE.width,
  });
};

/** The slide drawn in `host` as a JPEG `data:` URL. */
export const slidePicture = async (host: HTMLElement): Promise<string> => {
  const drawn = await drawSlide(host);
  const page = document.createElement("canvas");
  page.width = drawn.width;
  page.height = drawn.height;
  const context = page.getContext("2d");
  if (!context) {
    throw new Error("The slide picture needs a canvas context.");
  }
  // JPEG drops alpha; transparent parts of a slide show its theme's paper.
  context.fillStyle =
    getComputedStyle(host).getPropertyValue("--background").trim() || "white";
  context.fillRect(0, 0, page.width, page.height);
  context.drawImage(drawn, 0, 0);
  return page.toDataURL("image/jpeg", PAGE_QUALITY);
};

/** Pictures of single elements of the slide drawn in `host`. */
export const regionRasterizer =
  (host: HTMLElement): Rasterize =>
  async (element, region) => {
    if (region.w <= 0 || region.h <= 0) {
      return null;
    }
    const style = document.createElement("style");
    style.textContent = ISOLATE_CSS;
    document.head.append(style);
    host.classList.add(ISOLATE);
    element.setAttribute(TARGET, "");
    let slide: HTMLCanvasElement;
    try {
      slide = await drawSlide(host);
    } catch {
      return null;
    } finally {
      element.removeAttribute(TARGET);
      host.classList.remove(ISOLATE);
      style.remove();
    }
    const context = slide.getContext("2d");
    if (!context) {
      return null;
    }
    const cut = context.getImageData(
      Math.round(region.x * PIXEL_RATIO),
      Math.round(region.y * PIXEL_RATIO),
      Math.round(region.w * PIXEL_RATIO),
      Math.round(region.h * PIXEL_RATIO)
    );
    // The region was grown for shadows and blurs; keep what's painted.
    const painted = opaqueBounds(cut.data, cut.width, cut.height);
    if (!painted) {
      return null;
    }
    const out = document.createElement("canvas");
    out.width = painted.w;
    out.height = painted.h;
    out.getContext("2d")?.putImageData(cut, -painted.x, -painted.y);
    return {
      h: painted.h / PIXEL_RATIO,
      src: out.toDataURL("image/png"),
      type: "image",
      w: painted.w / PIXEL_RATIO,
      x: region.x + painted.x / PIXEL_RATIO,
      y: region.y + painted.y / PIXEL_RATIO,
    };
  };
