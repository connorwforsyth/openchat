import {
  type AnnotationTarget,
  annotationTargetSchema,
} from "@workspace/ai/messages/annotations";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import {
  type IncomingMessage,
  type MessageRejection,
  RUNTIME_CHANNEL,
} from "../runtime-protocol";

export type { AnnotationTarget } from "@workspace/ai/messages/annotations";

// "What is at x,y?" across the artifact frame (night 2, decision 5). The
// annotate layer over an artifact knows only where the person pointed; when
// the artifact renders in the runtime's frame, it may ask the frame what is
// there. Only the host asks, and only for a mark the person just made: the
// frame never starts this, and an answer is accepted once, for the request
// it names, from the frame it was sent to, parsed and capped. What comes
// back is the artifact's own claim about itself, so it's quoted to the
// model as untrusted page content (`@workspace/ai/messages/annotations`).
//
// HTML pages and sites render one frame further in, as `srcdoc` documents
// the runtime page can't reach into. The runtime passes the question on to
// the script it writes into those pages (`probeScript`) and the answer back.

const requestIdSchema = z.string().min(1).max(64);
const coordinate = z.number().min(0).max(100_000);

/** Host → frame: what is at this point (and, for a box, in it)? */
export const probeRequestSchema = z.object({
  channel: z.literal(RUNTIME_CHANNEL),
  height: coordinate,
  request: requestIdSchema,
  type: z.literal("annotate-probe"),
  width: coordinate,
  /** In the frame's viewport, as `elementFromPoint` takes them. */
  x: coordinate,
  y: coordinate,
});
export type ProbeRequest = z.infer<typeof probeRequestSchema>;

/** Frame → host: what was there, or `null` for nothing it can name. */
export const probeAnswerSchema = z.object({
  channel: z.literal(RUNTIME_CHANNEL),
  request: requestIdSchema,
  target: annotationTargetSchema.nullable(),
  type: z.literal("annotate-probed"),
});
export type ProbeAnswer = z.infer<typeof probeAnswerSchema>;

const OPAQUE_ORIGIN = "null";

/** In the frame: a probe from the window that embeds it, on its origin. */
export const readProbeRequest = (
  event: IncomingMessage,
  expected: { readonly origin: string; readonly source: unknown }
): Result<ProbeRequest, MessageRejection> => {
  if (event.source !== expected.source) {
    return err("source");
  }
  if (event.origin !== expected.origin) {
    return err("origin");
  }
  const parsed = probeRequestSchema.safeParse(event.data);
  return parsed.success ? ok(parsed.data) : err("shape");
};

/** In the host: the answer to `request`, from the frame it asked. */
export const readProbeAnswer = (
  event: IncomingMessage,
  frame: unknown,
  request: string
): Result<AnnotationTarget | null, MessageRejection> => {
  if (frame === null || frame === undefined || event.source !== frame) {
    return err("source");
  }
  if (event.origin !== OPAQUE_ORIGIN) {
    return err("origin");
  }
  const parsed = probeAnswerSchema.safeParse(event.data);
  if (!parsed.success) {
    return err("shape");
  }
  return parsed.data.request === request
    ? ok(parsed.data.target)
    : err("channel");
};

/** Namespaces the runtime's question to a page nested inside it. */
export const NESTED_PROBE_CHANNEL = "artifact-runtime/probe";

const nestedAnswerSchema = z.object({
  channel: z.literal(NESTED_PROBE_CHANNEL),
  request: requestIdSchema,
  target: annotationTargetSchema.nullable(),
  type: z.literal("probed"),
});

/** In the runtime: a nested page's answer to `request`, from that page. */
export const readNestedAnswer = (
  event: IncomingMessage,
  page: unknown,
  request: string
): AnnotationTarget | null | undefined => {
  if (page === null || page === undefined || event.source !== page) {
    return;
  }
  const parsed = nestedAnswerSchema.safeParse(event.data);
  return parsed.success && parsed.data.request === request
    ? parsed.data.target
    : undefined;
};

/**
 * What is at `(x, y)` in this document, in the terms a note uses: a slide
 * of a deck, a Mermaid node, a box of an SVG, or any element by a short
 * CSS selector, with the text it shows. `null` for the page itself.
 *
 * It runs in the runtime page and, as source text, in pages nested in it
 * (`probeScript`), so it closes over nothing: everything it needs is
 * inside it, its limits included.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one self-contained function, since it's also sent as source text; its helpers can't live outside it.
export function locateAt(
  x: number,
  y: number,
  width: number,
  height: number
): unknown {
  const quoteLength = 280;
  const selectorLength = 300;
  // biome-ignore lint/performance/useTopLevelRegex: self-contained (see above).
  const simple = /^[A-Za-z_][\w-]*$/;
  const clip = (value: string | null | undefined, max: number) => {
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const step = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (element.id && simple.test(element.id)) {
      return `${tag}#${element.id}`;
    }
    const classes = [...element.classList]
      .filter((name) => simple.test(name))
      .slice(0, 2);
    const named = classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
    const siblings = element.parentElement
      ? [...element.parentElement.children].filter(
          (sibling) => sibling.tagName === element.tagName
        )
      : [];
    return siblings.length > 1
      ? `${named}:nth-of-type(${siblings.indexOf(element) + 1})`
      : named;
  };
  const selectorOf = (element: Element, stop: Element | null) => {
    const steps: string[] = [];
    let at: Element | null = element;
    while (
      at &&
      at !== stop &&
      at !== document.body &&
      at !== document.documentElement &&
      steps.length < 6
    ) {
      steps.unshift(step(at));
      if (at.id && simple.test(at.id)) {
        break;
      }
      at = at.parentElement;
    }
    return clip(steps.join(" > "), selectorLength) || undefined;
  };
  const textOf = (element: Element) =>
    clip(
      element instanceof HTMLElement ? element.innerText : element.textContent,
      quoteLength
    ) || undefined;

  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) {
      break;
    }
    hit = inner;
  }
  if (!hit || hit === document.body || hit === document.documentElement) {
    return null;
  }

  const slide = hit.closest(".deck-slide[data-slide]");
  if (slide) {
    const slides = [...document.querySelectorAll(".deck-slide[data-slide]")];
    const canvas = slide.querySelector(".deck-canvas");
    const inSlide = hit !== slide && hit !== canvas;
    return {
      selector: inSlide ? selectorOf(hit, canvas ?? slide) : undefined,
      slide: slides.indexOf(slide) + 1,
      text: inSlide ? textOf(hit) : undefined,
      type: "slide",
    };
  }
  const node = hit.closest("g.node, g.cluster");
  if (node?.id) {
    return {
      id: clip(node.id, 200),
      label: clip(node.textContent, quoteLength) || undefined,
      type: "node",
    };
  }
  let svg = hit.closest("svg");
  while (svg?.parentElement?.closest("svg")) {
    svg = svg.parentElement.closest("svg");
  }
  if (svg && width > 0 && height > 0) {
    const box = svg.getBoundingClientRect();
    const fraction = (value: number) => Math.min(1, Math.max(0, value));
    if (box.width > 0 && box.height > 0) {
      const left = fraction((x - width / 2 - box.left) / box.width);
      const top = fraction((y - height / 2 - box.top) / box.height);
      return {
        height: fraction((y + height / 2 - box.top) / box.height) - top,
        type: "box",
        width: fraction((x + width / 2 - box.left) / box.width) - left,
        x: left,
        y: top,
      };
    }
  }
  const selector = selectorOf(hit, null);
  return selector ? { selector, text: textOf(hit), type: "element" } : null;
}

/**
 * What `locateAt` found, if it's a target a note can carry: anything else,
 * including a page's own reply, is dropped. Pure.
 */
export const asTarget = (value: unknown): AnnotationTarget | null => {
  const parsed = annotationTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * The script the runtime writes into a nested page: it answers the
 * runtime's probe with `locateAt`, and nothing else.
 */
export const probeScript = (): string =>
  `<script>(() => {
  const locate = ${locateAt.toString()};
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.channel !== "${NESTED_PROBE_CHANNEL}" || data.type !== "probe") return;
    let target = null;
    try { target = locate(data.x, data.y, data.width, data.height); } catch {}
    parent.postMessage({ channel: "${NESTED_PROBE_CHANNEL}", request: data.request, target, type: "probed" }, "*");
  });
})();</script>`;

/** The question the runtime passes on to a nested page, in its coordinates. */
export const nestedProbe = (
  request: ProbeRequest,
  offset: { readonly left: number; readonly top: number }
) => ({
  channel: NESTED_PROBE_CHANNEL,
  height: request.height,
  request: request.request,
  type: "probe",
  width: request.width,
  x: request.x - offset.left,
  y: request.y - offset.top,
});
