import type { CSSProperties, ReactNode } from "react";

import {
  SLIDE_COLOR,
  SLIDE_FONT,
  SLIDE_HEIGHT,
  SLIDE_PADDING,
  SLIDE_SPACE,
  SLIDE_TYPE,
  SLIDE_WIDTH,
} from "./scale";

// The canvas and the pieces any slide may use (164). Styles are inline, on
// the theme's CSS variables: the runtime page that shows a slide has no
// Tailwind, and the PowerPoint export reads the computed styles back. Every
// word arrives as a prop or a child: it's the deck's content, in the deck's
// language, not the product's UI (so not Lingui's).

export type SlideTone = "default" | "inverse" | "muted";

const TONES: Readonly<Record<SlideTone, CSSProperties>> = {
  default: {
    backgroundColor: SLIDE_COLOR.background,
    color: SLIDE_COLOR.foreground,
  },
  inverse: {
    backgroundColor: SLIDE_COLOR.accent,
    color: SLIDE_COLOR.accentForeground,
  },
  muted: { backgroundColor: SLIDE_COLOR.muted, color: SLIDE_COLOR.foreground },
};

export interface SlideProps {
  /** `center` puts the content in the middle of the canvas. */
  readonly align?: "center" | "start";
  readonly children?: ReactNode;
  /** `inverse` is the accent colour; `muted` the quiet background. */
  readonly tone?: SlideTone;
}

/** The 1920×1080 canvas, with its margins: a blank slide to compose on. */
export function Slide({
  align = "start",
  children,
  tone = "default",
}: SlideProps) {
  return (
    <section
      data-slide-canvas=""
      style={{
        ...TONES[tone],
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        fontFamily: SLIDE_FONT,
        fontSize: SLIDE_TYPE.body,
        gap: SLIDE_SPACE.md,
        height: SLIDE_HEIGHT,
        justifyContent: align === "center" ? "center" : "flex-start",
        lineHeight: 1.3,
        overflow: "hidden",
        paddingBlock: SLIDE_PADDING.block,
        paddingInline: SLIDE_PADDING.inline,
        position: "relative",
        textAlign: align === "center" ? "center" : "start",
        width: SLIDE_WIDTH,
      }}
    >
      {children}
    </section>
  );
}

/**
 * Shown one at a time as the presenter advances, in the order they appear;
 * every step shows in the overview and in exports.
 */
export function Step({ children }: { readonly children?: ReactNode }) {
  return <div data-step="">{children}</div>;
}

/**
 * Speaker notes written in the slide itself: never drawn, shown to the
 * presenter beside the deck's own notes for the slide.
 */
export function Notes({ children }: { readonly children?: ReactNode }) {
  return (
    <aside data-notes="" hidden>
      {children}
    </aside>
  );
}

export interface LogoProps {
  /** Words for the picture, or the mark itself without `src`. */
  readonly alt?: string;
  /** A `data:` URL; the runtime loads nothing from the network. */
  readonly src?: string;
  readonly text?: string;
}

/** A small mark in the canvas's bottom end corner. */
export function Logo({ alt = "", src, text }: LogoProps) {
  return (
    <div
      style={{
        alignItems: "center",
        color: SLIDE_COLOR.mutedForeground,
        display: "flex",
        fontSize: SLIDE_TYPE.caption,
        fontWeight: 600,
        gap: SLIDE_SPACE.xs,
        insetBlockEnd: SLIDE_SPACE.lg,
        insetInlineEnd: SLIDE_PADDING.inline,
        position: "absolute",
      }}
    >
      {src ? (
        // biome-ignore lint/performance/noImgElement: slides render outside any framework's image pipeline.
        <img
          alt={alt}
          height={56}
          src={src}
          style={{ height: 56, width: "auto" }}
          width={168}
        />
      ) : null}
      {text ? <span>{text}</span> : null}
    </div>
  );
}

/** A slide's heading, in the type scale. */
export function Heading({
  children,
  size = "heading",
}: {
  readonly children?: ReactNode;
  readonly size?: "display" | "heading" | "title";
}) {
  return (
    <h2
      style={{
        fontSize: SLIDE_TYPE[size],
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: 1.08,
        margin: 0,
        textWrap: "balance",
      }}
    >
      {children}
    </h2>
  );
}

/** Quieter text under a heading. */
export function Lede({ children }: { readonly children?: ReactNode }) {
  return (
    <p
      style={{
        color: "inherit",
        fontSize: SLIDE_TYPE.body,
        margin: 0,
        opacity: 0.75,
        textWrap: "pretty",
      }}
    >
      {children}
    </p>
  );
}

/** The small capitals over a title. */
export function Eyebrow({ children }: { readonly children?: ReactNode }) {
  return (
    <p
      style={{
        fontSize: SLIDE_TYPE.eyebrow,
        fontWeight: 600,
        letterSpacing: "0.12em",
        margin: 0,
        opacity: 0.7,
        textTransform: "uppercase",
      }}
    >
      {children}
    </p>
  );
}
