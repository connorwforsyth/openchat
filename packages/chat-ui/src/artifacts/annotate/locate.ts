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

/** Lines of code, where the view numbers them (`data-line`). */
const codeLine = (element: Element): AnnotationTarget | null => {
  const line = element.closest("[data-line]")?.getAttribute("data-line");
  if (!(line && LINE.test(line))) {
    return null;
  }
  const number = Number(line);
  return number > 0 ? { end: number, start: number, type: "lines" } : null;
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

/** The element our own view drew at `box`, through any shadow roots. */
const hitAt = (box: ClientBox, skip: Element): Element | null => {
  let hit =
    document
      .elementsFromPoint(box.x, box.y)
      .find((element) => !skip.contains(element)) ?? null;
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(box.x, box.y);
    if (!inner || inner === hit) {
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

/**
 * What is under `box`: a view's registered locator, then what our views
 * draw (a document's passage, a diagram node, an image, code lines), then
 * the runtime frame's answer. `skip` is the layer's own overlay.
 */
export const locate = (
  box: ClientBox,
  skip: Element,
  locators: ReadonlyMap<Element, Locator>
): Promise<AnnotationTarget | null> => {
  const hit = hitAt(box, skip);
  if (!hit) {
    return Promise.resolve(null);
  }
  if (hit instanceof HTMLIFrameElement) {
    return probeFrame(hit, box);
  }
  for (let at: Element | null = hit; at; at = at.parentElement) {
    const locator = locators.get(at);
    if (locator) {
      return Promise.resolve(locator(box));
    }
  }
  if (hit instanceof HTMLImageElement) {
    return Promise.resolve(imageBox(hit, box));
  }
  return Promise.resolve(
    asTarget(passage(hit) ?? diagramNode(hit) ?? codeLine(hit))
  );
};
