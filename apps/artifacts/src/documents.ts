import {
  MAX_FRAME_HEIGHT,
  type RuntimeError,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { runtimeError } from "./errors";

// HTML and SVG artifacts. Both are documents rather than code we compile, so
// they only need a place to live inside the runtime page.

/** Renders the teardown for whatever a renderer put in the page. */
export type Teardown = () => void;

/** Namespaces the reporter's messages, like the runtime protocol's. */
export const HTML_REPORTER_CHANNEL = "artifact-runtime/html";

const reporterMessageSchema = z.discriminatedUnion("type", [
  z.object({
    channel: z.literal(HTML_REPORTER_CHANNEL),
    height: z.number().min(0).max(MAX_FRAME_HEIGHT),
    type: z.literal("height"),
  }),
  z.object({
    channel: z.literal(HTML_REPORTER_CHANNEL),
    message: z.string().max(4000),
    type: z.literal("error"),
  }),
]);

// Runs first in the artifact's document: reports its height (the <html>
// box, which unlike scrollHeight can shrink below the frame) and its errors.
const REPORTER = `<script>(() => {
  const post = (data) => parent.postMessage({ channel: "${HTML_REPORTER_CHANNEL}", ...data }, "*");
  const root = document.documentElement;
  new ResizeObserver(() => post({ type: "height", height: Math.ceil(root.getBoundingClientRect().height) })).observe(root);
  addEventListener("error", (event) => post({ type: "error", message: String(event.error?.message ?? event.message) }));
})();</script>`;

const HEAD = /<head(?:\s[^>]*)?>/i;
const HTML = /<html(?:\s[^>]*)?>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * The artifact with the reporter as its first script: after `<head>` or
 * `<html>` if it has one, else after the doctype, so a standards-mode page
 * stays in standards mode.
 */
export const withReporter = (html: string): string => {
  const anchor = HEAD.exec(html) ?? HTML.exec(html) ?? DOCTYPE.exec(html);
  if (!anchor) {
    return REPORTER + html;
  }
  const at = anchor.index + anchor[0].length;
  return html.slice(0, at) + REPORTER + html.slice(at);
};

/**
 * An HTML artifact is a whole document, so it gets its own nested `srcdoc`
 * frame, which inherits the runtime's sandbox and CSP. Being sandboxed, it
 * also gets its own opaque origin, so we can't measure it from here: a small
 * reporter script in the document posts its height and errors up instead.
 */
export const renderHtml = (
  container: HTMLElement,
  html: string,
  callbacks: {
    readonly onError: (error: RuntimeError) => void;
    readonly onLoad: () => void;
  }
): Teardown => {
  const frame = document.createElement("iframe");
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) {
      return;
    }
    const message = reporterMessageSchema.safeParse(event.data);
    if (!message.success) {
      return;
    }
    if (message.data.type === "height") {
      frame.style.height = `${message.data.height}px`;
    } else {
      callbacks.onError({ kind: "render", message: message.data.message });
    }
  };
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", callbacks.onLoad);
  frame.srcdoc = withReporter(html);
  container.append(frame);
  return () => {
    window.removeEventListener("message", onMessage);
    frame.remove();
  };
};

/**
 * Parsed as XML rather than set as HTML, so a malformed SVG is reported as
 * one instead of rendering half-way.
 */
export const parseSvg = (svg: string): Result<SVGSVGElement, RuntimeError> => {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const problem = parsed.querySelector("parsererror");
  if (problem) {
    return err(runtimeError("syntax", problem.textContent ?? ""));
  }
  const root = parsed.documentElement;
  return root instanceof SVGSVGElement
    ? ok(document.importNode(root, true))
    : err(runtimeError("syntax", "The artifact isn't an <svg> element."));
};
