import type { LayoutColor, LayoutItem, SlideLayout } from "./slide-layout";
import {
  type Box,
  type ChartLook,
  chartItemOf,
  RASTER_BLEED,
  rasterReason,
  regionOf,
} from "./slide-rules";

// A rendered slide's DOM as a layout tree (164), for the exports: every
// painted box a shape, every run of text a text box, every picture an
// image, at its place on the 1920×1080 canvas. It runs in the runtime's
// browser, on a slide drawn at full size (not scaled), and reads computed
// styles, so the theme's colours arrive as the browser resolved them.

/** A CSS colour as channels, or `null` when it paints nothing. A port: the runtime reads colours through a canvas. */
export type ReadColor = (css: string) => LayoutColor | null;

/** Reads colours by painting one pixel, so any syntax the browser knows works. */
export const canvasColorReader = (): ReadColor => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, LayoutColor | null>();
  return (css) => {
    if (!context) {
      return null;
    }
    const known = cache.get(css);
    if (known !== undefined) {
      return known;
    }
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, alpha = 0] = context.getImageData(
      0,
      0,
      1,
      1
    ).data;
    const color = alpha === 0 ? null : { a: alpha / 255, b, g, r };
    cache.set(css, color);
    return color;
  };
};

const ALIGN: Readonly<Record<string, "center" | "left" | "right">> = {
  center: "center",
  end: "right",
  justify: "left",
  left: "left",
  right: "right",
  start: "left",
};

const hasOwnText = (element: Element): boolean =>
  [...element.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );

const px = (value: string): number => Number.parseFloat(value) || 0;

/** An `<img>`'s picture as a `data:` URL, or `null` if it can't be read. */
const pictureOf = async (
  image: HTMLImageElement,
  width: number,
  height: number
): Promise<string | null> => {
  const source = image.currentSrc || image.src;
  if (!source.startsWith("data:")) {
    // The runtime loads nothing from the network, so there's nothing to embed.
    return null;
  }
  if (
    source.startsWith("data:image/png") ||
    source.startsWith("data:image/jpeg")
  ) {
    return source;
  }
  const decoded = new Image();
  decoded.src = source;
  try {
    await decoded.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas
    .getContext("2d")
    ?.drawImage(decoded, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

/**
 * A picture of `element` as the browser draws it, cut to `region` of the
 * slide: a port, so the walk stays free of the rasterizer.
 */
export type Rasterize = (
  element: Element,
  region: Box
) => Promise<Extract<LayoutItem, { type: "image" }> | null>;

/** `color` seen through its own and its ancestors' opacity. */
const faded = (
  color: LayoutColor | null,
  opacity: number
): LayoutColor | null =>
  color === null || opacity >= 1 ? color : { ...color, a: color.a * opacity };

const TRAILING_SPACE = /\s+\n/g;

/** A list item's marker, which the exports draw themselves. */
const bulletOf = (element: HTMLElement): "bullet" | "none" | "number" => {
  if (element.tagName !== "LI") {
    return "none";
  }
  const marker = getComputedStyle(element).listStyleType;
  if (marker === "none") {
    return "none";
  }
  return marker === "decimal" ? "number" : "bullet";
};

const textOf = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
  box: Box,
  readColor: ReadColor,
  opacity: number
): LayoutItem | null => {
  const text = element.innerText.replace(TRAILING_SPACE, "\n").trim();
  const color = faded(readColor(style.color), opacity);
  if (text === "" || !color) {
    return null;
  }
  const fontSize = px(style.fontSize);
  return {
    ...box,
    align: ALIGN[style.textAlign] ?? "left",
    bold: Number(style.fontWeight) >= 600,
    bullet: bulletOf(element),
    color,
    fontSize,
    italic: style.fontStyle === "italic",
    lineHeight:
      style.lineHeight === "normal" || fontSize === 0
        ? 1.2
        : px(style.lineHeight) / fontSize,
    text,
    type: "text",
  };
};

/** A painted box (a fill, a border), or `null` when it paints nothing. */
const shapeOf = (
  style: CSSStyleDeclaration,
  box: Box,
  readColor: ReadColor,
  opacity: number
): LayoutItem | null => {
  const fill = faded(readColor(style.backgroundColor), opacity);
  const width = px(style.borderTopWidth);
  const line =
    width > 0 && style.borderTopStyle !== "none"
      ? faded(readColor(style.borderTopColor), opacity)
      : null;
  return fill || line
    ? {
        ...box,
        fill,
        line: line ? { color: line, width } : null,
        radius: px(style.borderTopLeftRadius),
        type: "shape",
      }
    : null;
};

const isHidden = (style: CSSStyleDeclaration): boolean =>
  style.display === "none" ||
  style.visibility === "hidden" ||
  Number(style.opacity) === 0;

/** The chart slide-ui's `Chart` drew in `figure`, in the theme's colours. */
const chartLookOf = (
  figure: Element,
  svg: Element,
  readColor: ReadColor
): ChartLook => {
  const style = getComputedStyle(figure);
  const colors = [1, 2, 3, 4, 5].flatMap((n) => {
    const color = readColor(style.getPropertyValue(`--chart-${n}`).trim());
    return color ? [color] : [];
  });
  // The drawing's labels are sized in its viewBox, which is scaled to fit.
  const label = svg.querySelector("text");
  const viewBox = (svg as SVGSVGElement).viewBox?.baseVal;
  const scale =
    viewBox && viewBox.width > 0
      ? svg.getBoundingClientRect().width / viewBox.width
      : 1;
  return {
    colors,
    fontSize: label ? px(getComputedStyle(label).fontSize) * scale || 28 : 28,
    labelColor: (label && readColor(getComputedStyle(label).fill)) ??
      readColor(style.color) ?? { a: 1, b: 0, g: 0, r: 0 },
  };
};

/**
 * A slide-ui `Chart`'s figure as a native chart, and the figure's other
 * children still to visit; `null` if `element` isn't one or its data
 * doesn't read, so it's drawn as anything else is.
 */
const chartOf = (
  element: Element,
  origin: DOMRect,
  readColor: ReadColor
): Found | null => {
  const data = element.getAttribute("data-slide-chart");
  const svg = data === null ? null : element.querySelector("svg");
  if (data === null || svg === null) {
    return null;
  }
  const chart = chartItemOf(
    data,
    boxOf(svg, origin),
    chartLookOf(element, svg, readColor)
  );
  return chart.ok
    ? {
        // The native chart draws its own legend.
        children: [...element.children].filter(
          (child) => child !== svg && child.tagName !== "FIGCAPTION"
        ),
        items: [chart.value],
      }
    : null;
};

interface Walk {
  /** The element's opacity and its ancestors', multiplied. */
  readonly opacity: number;
  /** `null` when the export draws the slide from its picture (the PDF). */
  readonly rasterize: Rasterize | null;
  readonly readColor: ReadColor;
}

interface Found {
  /** The children still to visit; none when this element was whole. */
  readonly children: readonly Element[];
  readonly items: readonly LayoutItem[];
}

const boxOf = (element: Element, origin: DOMRect): Box => {
  const rect = element.getBoundingClientRect();
  return {
    h: rect.height,
    w: rect.width,
    x: rect.left - origin.left,
    y: rect.top - origin.top,
  };
};

/**
 * What one element contributes, and which children still need a visit: a
 * picture, a chart or a block of text is whole; a box is drawn under its
 * children.
 */
const itemsOf = async (
  element: Element,
  box: Box,
  origin: DOMRect,
  { isCanvas, rasterize, readColor, opacity }: Walk & { isCanvas: boolean }
): Promise<Found> => {
  const style = getComputedStyle(element);
  const none: Found = { children: [], items: [] };
  if (isHidden(style) || box.w === 0 || box.h === 0) {
    return none;
  }
  const chart = rasterize ? chartOf(element, origin, readColor) : null;
  if (chart) {
    return chart;
  }
  const reason = rasterReason({
    backdropFilter: style.backdropFilter,
    backgroundImage: style.backgroundImage,
    boxShadow: style.boxShadow,
    clipPath: style.clipPath,
    filter: style.filter,
    maskImage: style.maskImage,
    tag: element.tagName,
    transform: style.transform,
  });
  if (reason && rasterize) {
    const picture = await rasterize(
      element,
      regionOf(box, RASTER_BLEED[reason])
    );
    return { children: [], items: picture === null ? [] : [picture] };
  }
  if (reason === "svg" || reason === "canvas") {
    return none;
  }
  if (element instanceof HTMLImageElement) {
    const src = await pictureOf(element, box.w, box.h);
    return {
      children: [],
      items: src ? [{ ...box, src, type: "image" }] : [],
    };
  }
  const shape = isCanvas ? null : shapeOf(style, box, readColor, opacity);
  const items = shape ? [shape] : [];
  // Text a block holds directly is one text box, with its inline runs.
  if (element instanceof HTMLElement && hasOwnText(element)) {
    const text = textOf(element, style, box, readColor, opacity);
    return { children: [], items: text ? [...items, text] : items };
  }
  return { children: [...element.children], items };
};

/**
 * The layout of the slide drawn in `canvas` (its 1920×1080 element), with
 * `notes`. Hidden elements are left out; a step counts as shown. With
 * `rasterize` (the PowerPoint), what can't be a native shape, text box or
 * chart becomes a picture of its region; without it (the PDF, which has a
 * picture of the whole slide), only the text matters.
 */
export const captureSlide = async (
  canvas: HTMLElement,
  notes: string,
  {
    rasterize,
    readColor,
  }: { readonly rasterize: Rasterize | null; readonly readColor: ReadColor }
): Promise<SlideLayout> => {
  const origin = canvas.getBoundingClientRect();
  const items: LayoutItem[] = [];

  const visit = async (
    element: Element,
    isCanvas: boolean,
    opacity: number
  ): Promise<void> => {
    const own = opacity * Number(getComputedStyle(element).opacity || 1);
    const found = await itemsOf(element, boxOf(element, origin), origin, {
      isCanvas,
      opacity: own,
      rasterize,
      readColor,
    });
    items.push(...found.items);
    for (const child of found.children) {
      // biome-ignore lint/performance/noAwaitInLoops: in document order, which is the order the slide paints.
      await visit(child, false, own);
    }
  };

  await visit(canvas, true, 1);
  return {
    background: readColor(getComputedStyle(canvas).backgroundColor),
    items,
    notes,
    picture: null,
  };
};
