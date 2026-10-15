import type { LayoutColor, LayoutItem, SlideLayout } from "./slide-layout";

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

/** An `<svg>` or `<img>` as a PNG `data:` URL, or `null` if it can't be read. */
const pictureOf = async (
  element: Element,
  width: number,
  height: number
): Promise<string | null> => {
  const source =
    element instanceof HTMLImageElement
      ? element.currentSrc || element.src
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(element))}`;
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
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

type Box = Pick<LayoutItem, "h" | "w" | "x" | "y">;

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
  readColor: ReadColor
): LayoutItem | null => {
  const text = element.innerText.replace(TRAILING_SPACE, "\n").trim();
  const color = readColor(style.color);
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
  readColor: ReadColor
): LayoutItem | null => {
  const fill = readColor(style.backgroundColor);
  const width = px(style.borderTopWidth);
  const line =
    width > 0 && style.borderTopStyle !== "none"
      ? readColor(style.borderTopColor)
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

/**
 * What one element contributes, and whether its children still need a
 * visit: a picture or a block of text is whole; a box is drawn under its
 * children.
 */
const itemsOf = async (
  element: Element,
  box: Box,
  { isCanvas, readColor }: { isCanvas: boolean; readColor: ReadColor }
): Promise<{ items: LayoutItem[]; visitChildren: boolean }> => {
  const style = getComputedStyle(element);
  if (isHidden(style) || box.w === 0 || box.h === 0) {
    return { items: [], visitChildren: false };
  }
  if (element instanceof HTMLImageElement || element instanceof SVGSVGElement) {
    const src = await pictureOf(element, box.w, box.h);
    return {
      items: src ? [{ ...box, src, type: "image" }] : [],
      visitChildren: false,
    };
  }
  const shape = isCanvas ? null : shapeOf(style, box, readColor);
  const items = shape ? [shape] : [];
  // Text a block holds directly is one text box, with its inline runs.
  if (element instanceof HTMLElement && hasOwnText(element)) {
    const text = textOf(element, style, box, readColor);
    return { items: text ? [...items, text] : items, visitChildren: false };
  }
  return { items, visitChildren: true };
};

/**
 * The layout of the slide drawn in `canvas` (its 1920×1080 element), with
 * `notes`. Hidden elements are left out; a step counts as shown.
 */
export const captureSlide = async (
  canvas: HTMLElement,
  notes: string,
  readColor: ReadColor
): Promise<SlideLayout> => {
  const origin = canvas.getBoundingClientRect();
  const items: LayoutItem[] = [];

  const visit = async (element: Element, isCanvas: boolean): Promise<void> => {
    const rect = element.getBoundingClientRect();
    const found = await itemsOf(
      element,
      {
        h: rect.height,
        w: rect.width,
        x: rect.left - origin.left,
        y: rect.top - origin.top,
      },
      { isCanvas, readColor }
    );
    items.push(...found.items);
    if (found.visitChildren) {
      for (const child of element.children) {
        // biome-ignore lint/performance/noAwaitInLoops: in document order, which is the order the slide paints.
        await visit(child, false);
      }
    }
  };

  await visit(canvas, true);
  return {
    background: readColor(getComputedStyle(canvas).backgroundColor),
    items,
    notes,
  };
};
