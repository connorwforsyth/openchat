// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/lib/inspector/{pick-target,inline-text,visual-dom}.ts
// and components/inspector/inspect-overlay.tsx.
// MIT, Copyright (c) 2026 Yiwei Ho; see NOTICE.open-slide.
import { slideFileName } from "@workspace/artifacts-kit/kinds/presentation/content";
import type { SlideTarget } from "@workspace/artifacts-kit/kinds/presentation/edit-target";
import type { PickedElement } from "@workspace/chat-ui/artifacts/runtime-protocol";

import type { ReadColor } from "./slide-capture";

type ElementStyle = PickedElement["style"];
type ThemeColor = PickedElement["theme"][number];

// Picking an element in a slide for the slides editor (n2), on the runtime
// page. open-slide's inspector runs in the same window as its slides; ours
// runs here, beside them, and tells the editor what was picked as data:
// where it's written (`data-src`), which part of a layout it is
// (`data-part`, `data-prop`), its words and its styles as drawn. Hovering
// outlines what a click would pick. The editor rewrites the source and
// draws the deck again.

// Tags that are part of a run of text rather than a container of their
// own, so `<p>a <strong>b</strong></p>` stays one thing to pick.
const INLINE_TEXT_TAGS = new Set([
  "B",
  "CODE",
  "DEL",
  "EM",
  "I",
  "INS",
  "MARK",
  "S",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "U",
]);

const hasOnlyInlineText = (element: Element): boolean =>
  [...element.childNodes].every(
    (child) =>
      child.nodeType === Node.TEXT_NODE ||
      (child instanceof HTMLElement &&
        (child.tagName === "BR" ||
          (INLINE_TEXT_TAGS.has(child.tagName) && hasOnlyInlineText(child))))
  );

const STAMP = /^(.+):(\d+):(\d+)$/;

/** A stamp's place in `file`, or `null` for another file's or no column. */
export const stampLocation = (
  stamp: string,
  file: string
): { readonly column: number; readonly line: number } | null => {
  const match = STAMP.exec(stamp);
  return match && match[1] === file
    ? { column: Number(match[3]), line: Number(match[2]) }
    : null;
};

export interface Pick {
  /** What's outlined and read: the part, or the element itself. */
  readonly anchor: HTMLElement;
  readonly target: SlideTarget;
}

/**
 * What a click on `element` picks in `slide`: the innermost part of a
 * layout, or the element written in the source, widened from inline text to
 * the run of text it's in. `null` outside anything written in the slide.
 */
export const pickAt = (
  element: Element,
  slide: string,
  root: Element
): Pick | null => {
  let start: Element = element;
  while (
    INLINE_TEXT_TAGS.has(start.tagName) &&
    start.parentElement &&
    root.contains(start.parentElement) &&
    hasOnlyInlineText(start.parentElement)
  ) {
    start = start.parentElement;
  }
  const stamped = start.closest<HTMLElement>("[data-src]");
  if (!(stamped && root.contains(stamped))) {
    return null;
  }
  const at = stampLocation(stamped.dataset.src ?? "", slideFileName(slide));
  if (!at) {
    return null;
  }
  const part = start.closest<HTMLElement>("[data-part]");
  if (part && stamped.contains(part)) {
    return {
      anchor: part,
      target: {
        ...at,
        part: part.dataset.part,
        ...(part.dataset.prop ? { prop: part.dataset.prop } : {}),
        slide,
      },
    };
  }
  return { anchor: stamped, target: { ...at, slide } };
};

/** The element `target` names, once the slide is drawn again. */
export const findTarget = (
  root: Element,
  target: SlideTarget
): HTMLElement | null => {
  const stamp = `${slideFileName(target.slide)}:${target.line}:${target.column}`;
  const stamped = [...root.querySelectorAll<HTMLElement>("[data-src]")].find(
    (each) => each.dataset.src === stamp
  );
  if (!stamped || target.part === undefined) {
    return stamped ?? null;
  }
  const parts = [
    stamped,
    ...stamped.querySelectorAll<HTMLElement>("[data-part]"),
  ].filter((each) => each.dataset.part === target.part);
  return (
    parts.find((each) => each.dataset.prop === target.prop) ?? parts[0] ?? null
  );
};

const byte = (value: number) => Math.round(value).toString(16).padStart(2, "0");

/** A colour as `#rrggbb`, or `null` when it's transparent. */
const hexOf = (readColor: ReadColor, css: string): string | null => {
  const color = readColor(css);
  return color ? `#${byte(color.r)}${byte(color.g)}${byte(color.b)}` : null;
};

const ALIGNS: Readonly<Record<string, ElementStyle["textAlign"]>> = {
  center: "center",
  end: "end",
  justify: "justify",
  left: "start",
  right: "end",
};

const pixels = (value: string): number => Number.parseFloat(value) || 0;

/** The styles `anchor` is drawn with. */
export const styleOf = (
  anchor: HTMLElement,
  readColor: ReadColor
): ElementStyle => {
  const style = getComputedStyle(anchor);
  const fontSize = pixels(style.fontSize);
  const lineHeight = Number.parseFloat(style.lineHeight);
  return {
    backgroundColor: hexOf(readColor, style.backgroundColor),
    color: hexOf(readColor, style.color) ?? `#${byte(0).repeat(3)}`,
    fontSize,
    fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
    fontWeight: Math.min(1000, Math.max(1, Number(style.fontWeight) || 400)),
    letterSpacing: pixels(style.letterSpacing),
    lineHeight:
      Number.isFinite(lineHeight) && fontSize > 0
        ? Math.round((lineHeight / fontSize) * 100) / 100
        : null,
    opacity: Number(style.opacity),
    textAlign: ALIGNS[style.textAlign] ?? "start",
  };
};

/** The deck theme's colours a slide may use, by variable (the slide guide's list). */
const THEME_COLORS = [
  "foreground",
  "muted-foreground",
  "primary",
  "background",
  "muted",
  "primary-foreground",
  "border",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

const themeOf = (readColor: ReadColor): ThemeColor[] => {
  const root = getComputedStyle(document.documentElement);
  return THEME_COLORS.flatMap((name) => {
    const value = hexOf(readColor, root.getPropertyValue(`--${name}`).trim());
    return value ? [{ name, value }] : [];
  });
};

/** Its words, when they're one run of text the editor can rewrite. */
const textOf = (anchor: HTMLElement, target: SlideTarget): string | null => {
  const text = anchor.textContent ?? "";
  if (target.prop !== undefined) {
    return text;
  }
  // A layout's part without a prop (a Quote's frame) isn't its words.
  if (target.part !== undefined) {
    return null;
  }
  return text.trim() && hasOnlyInlineText(anchor) ? text : null;
};

/** The element as the editor's inspector reads it. */
export const pickedElement = (
  { anchor, target }: Pick,
  readColor: ReadColor
): PickedElement => {
  const text = textOf(anchor, target);
  let kind: PickedElement["kind"] = "box";
  if (anchor instanceof HTMLImageElement) {
    kind = "image";
  } else if (text !== null) {
    kind = "text";
  }
  return {
    kind,
    style: styleOf(anchor, readColor),
    tag: anchor.tagName.toLowerCase().slice(0, 40),
    target,
    text: text?.slice(0, 10_000) ?? null,
    theme: themeOf(readColor),
  };
};

export interface Inspector {
  /** Picks `target` (or nothing) in the slide drawn now, and says so. */
  readonly pick: (target: SlideTarget | null) => void;
  readonly teardown: () => void;
}

/**
 * Picking in `frame`, the slide on screen: outlines, clicks and Escape. It
 * only reports; it never edits. The slide's own code runs in this window
 * and can post anything this can, so every change is made and checked by
 * the editor on the app's side.
 */
export const inspectSlide = (
  frame: HTMLElement,
  slide: string,
  {
    onPicked,
    readColor,
  }: {
    readonly onPicked: (element: PickedElement | null) => void;
    readonly readColor: ReadColor;
  }
): Inspector => {
  const hover = document.createElement("div");
  hover.className = "inspect-outline";
  hover.dataset.inspect = "hover";
  const chosen = document.createElement("div");
  chosen.className = "inspect-outline";
  chosen.dataset.inspect = "picked";
  frame.append(hover, chosen);
  frame.dataset.inspecting = "";

  let picked: Pick | null = null;

  const place = (outline: HTMLElement, anchor: HTMLElement | null) => {
    if (!anchor?.isConnected) {
      outline.hidden = true;
      return;
    }
    const box = frame.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    outline.hidden = false;
    outline.style.transform = `translate(${rect.left - box.left}px, ${rect.top - box.top}px)`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
  };

  const choose = (next: Pick | null) => {
    picked = next;
    place(chosen, next?.anchor ?? null);
    place(hover, null);
    onPicked(next ? pickedElement(next, readColor) : null);
  };

  const at = (event: Event): Pick | null =>
    event.target instanceof Element ? pickAt(event.target, slide, frame) : null;

  const onPointerMove = (event: PointerEvent) => {
    const next = at(event);
    place(hover, next && next.anchor !== picked?.anchor ? next.anchor : null);
  };
  const onPointerLeave = () => place(hover, null);
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    choose(at(event));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && picked) {
      choose(null);
    }
  };
  const onResize = () => {
    place(chosen, picked?.anchor ?? null);
  };

  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerleave", onPointerLeave);
  frame.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);

  return {
    pick: (target) => {
      const anchor = target ? findTarget(frame, target) : null;
      choose(anchor && target ? { anchor, target } : null);
    },
    teardown: () => {
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerleave", onPointerLeave);
      frame.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      hover.remove();
      chosen.remove();
      delete frame.dataset.inspecting;
    },
  };
};
