import type {
  AnnotationMark,
  AnnotationTarget,
} from "@workspace/ai/messages/annotations";
import { MAX_QUOTE_LENGTH } from "@workspace/ai/messages/annotations";

import { RUNTIME_CHANNEL } from "../runtime-protocol";
import { asTarget, type ProbeRequest, readProbeAnswer } from "./probe";

// Where a mark points, read on this side of the frame. The annotate layer
// draws marks over whatever the artifact's view renders; underneath is
// either one of our own views (a document, a grid, a diagram canvas, an
// image) or the runtime's frame. Our views are read directly, through a
// locator a view registers or the DOM they draw; the frame is asked
// (`./probe`). Anything else leaves the note with just its mark.

/** A view's own answer for a point (and box) in client coordinates. */
export type Locator = (box: ClientBox) => AnnotationTarget | null;

export interface ClientBox {
  readonly height: number;
  readonly width: number;
  /** The centre, in client coordinates. */
  readonly x: number;
  readonly y: number;
}

/** How long the frame has to answer before the note keeps just its mark. */
export const PROBE_TIMEOUT_MS = 600;

/** The mark's box in client coordinates, over `area` (the layer's view). Pure. */
export const clientBox = (mark: AnnotationMark, area: DOMRect): ClientBox =>
  mark.shape === "point"
    ? {
        height: 0,
        width: 0,
        x: area.left + mark.x * area.width,
        y: area.top + mark.y * area.height,
      }
    : {
        height: mark.height * area.height,
        width: mark.width * area.width,
        x: area.left + (mark.x + mark.width / 2) * area.width,
        y: area.top + (mark.y + mark.height / 2) * area.height,
      };

const clip = (value: string | null | undefined): string => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > MAX_QUOTE_LENGTH
    ? `${text.slice(0, MAX_QUOTE_LENGTH - 1)}…`
    : text;
};

const fraction = (value: number) => Math.min(1, Math.max(0, value));

/** The mark's box as fractions of `image`. */
const imageBox = (image: Element, box: ClientBox): AnnotationTarget | null => {
  const rect = image.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const left = fraction((box.x - box.width / 2 - rect.left) / rect.width);
  const top = fraction((box.y - box.height / 2 - rect.top) / rect.height);
  return {
    height: fraction((box.y + box.height / 2 - rect.top) / rect.height) - top,
    type: "box",
    width: fraction((box.x + box.width / 2 - rect.left) / rect.width) - left,
    x: left,
    y: top,
  };
};

const HEADINGS = "h1, h2, h3, h4, h5, h6";
const HEADING = /^H[1-6]$/;
const BLOCKS = `p, ${HEADINGS}, li, blockquote, pre, td, th`;

/** A passage of a document (ProseMirror), with the heading it's under. */
const passage = (element: Element): AnnotationTarget | null => {
  const editor = element.closest(".ProseMirror");
  const block = editor ? element.closest(BLOCKS) : null;
  if (!(editor && block)) {
    return null;
  }
  const text = clip(block.textContent);
  if (!text) {
    return null;
  }
  // Blocks and headings in document order: the last heading before the
  // block is the one it's under.
  const ordered = [...editor.querySelectorAll(BLOCKS)];
  const heading = ordered
    .slice(0, ordered.indexOf(block))
    .filter((each) => HEADING.test(each.tagName))
    .at(-1);
  const section = heading ? clip(heading.textContent) : "";
  return section ? { section, text, type: "text" } : { text, type: "text" };
};

const LINE = /^\d+$/;

/** Lines of code, where the view numbers them (`data-line`, its gutter). */
const codeLine = (element: Element): AnnotationTarget | null => {
  const row = element.closest("[data-line], [data-column-number]");
  const line =
    row?.getAttribute("data-line") ?? row?.getAttribute("data-column-number");
  if (!(line && LINE.test(line))) {
    return null;
  }
  const number = Number(line);
  if (number < 1) {
    return null;
  }
  // The gutter has only the number; the line's own row has its code.
  const text = row?.hasAttribute("data-line") ? clip(row.textContent) : "";
  return text
    ? { end: number, start: number, text, type: "lines" }
    : { end: number, start: number, type: "lines" };
};

/** A node of the editable diagram (React Flow). */
const diagramNode = (element: Element): AnnotationTarget | null => {
  const node = element.closest(".react-flow__node[data-id]");
  const id = node?.getAttribute("data-id");
  if (!(node && id)) {
    return null;
  }
  const label = clip(node.textContent);
  return label
    ? { id: id.slice(0, 200), label, type: "node" }
    : { id: id.slice(0, 200), type: "node" };
};

/**
 * An element and, through any shadow roots, the one drawn inside it. The
 * layer's overlay is on top, so a root's `elementFromPoint` would answer
 * with the overlay: the first of its `elementsFromPoint` in the root is it.
 */
const deepest = (element: Element, box: ClientBox): Element => {
  let hit = element;
  for (let root = hit.shadowRoot; root; root = hit.shadowRoot) {
    const shadow: ShadowRoot = root;
    const inner = shadow
      .elementsFromPoint(box.x, box.y)
      .find((each) => each !== hit && shadow.contains(each));
    if (!inner) {
      break;
    }
    hit = inner;
  }
  return hit;
};

/**
 * Asks the runtime's frame what is at `box`, or `null` when it doesn't
 * answer in time (a `srcdoc` frame has nobody to answer).
 */
export const probeFrame = (
  frame: HTMLIFrameElement,
  box: ClientBox,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<AnnotationTarget | null> => {
  const target = frame.contentWindow;
  if (!target) {
    return Promise.resolve(null);
  }
  const rect = frame.getBoundingClientRect();
  const request: ProbeRequest = {
    channel: RUNTIME_CHANNEL,
    height: box.height,
    request: crypto.randomUUID(),
    type: "annotate-probe",
    width: box.width,
    x: Math.max(0, box.x - rect.left),
    y: Math.max(0, box.y - rect.top),
  };
  return new Promise((resolve) => {
    const finish = (value: AnnotationTarget | null) => {
      window.removeEventListener("message", listen);
      window.clearTimeout(timer);
      resolve(value);
    };
    const listen = (event: MessageEvent) => {
      const answer = readProbeAnswer(event, target, request.request);
      if (answer.ok) {
        finish(answer.value);
      }
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", listen);
    // The frame's origin is opaque, so there's no origin to target; the
    // question carries only coordinates.
    target.postMessage(request, "*");
  });
};

/** What our own views say about `hit`, without asking a frame. */
const readView = (
  hit: Element,
  box: ClientBox,
  locators: ReadonlyMap<Element, Locator>
): AnnotationTarget | null => {
  for (let at: Element | null = hit; at; at = at.parentElement) {
    const locator = locators.get(at);
    if (locator) {
      return locator(box);
    }
  }
  if (hit instanceof HTMLImageElement) {
    return imageBox(hit, box);
  }
  return asTarget(passage(hit) ?? diagramNode(hit) ?? codeLine(hit));
};

/**
 * What is under `box`, from the top of what's drawn there down: a view's
 * registered locator, what our views draw (a document's passage, a diagram
 * node, an image, code lines), or the runtime frame's answer. Controls a
 * view lays over a frame (a deck's sorter) say nothing, so the frame under
 * them is asked. `skip` is the layer's own overlay.
 */
export const locate = (
  box: ClientBox,
  skip: Element,
  locators: ReadonlyMap<Element, Locator>
): Promise<AnnotationTarget | null> => {
  const stack = document
    .elementsFromPoint(box.x, box.y)
    .filter((element) => !skip.contains(element));
  for (const element of stack) {
    if (element instanceof HTMLIFrameElement) {
      return probeFrame(element, box);
    }
    const target = readView(deepest(element, box), box, locators);
    if (target) {
      return Promise.resolve(target);
    }
  }
  // A frame that takes no pointer (a thumbnail rail under its controls)
  // isn't hit at all; the last one drawn under the point is on top.
  const frame = [...document.querySelectorAll("iframe")]
    .filter((each) => !skip.contains(each) && covers(each, box))
    .at(-1);
  return frame ? probeFrame(frame, box) : Promise.resolve(null);
};

const covers = (element: Element, box: ClientBox): boolean => {
  const rect = element.getBoundingClientRect();
  return (
    box.x >= rect.left &&
    box.x < rect.right &&
    box.y >= rect.top &&
    box.y < rect.bottom
  );
};
