import type { ReactNode } from "react";

import { Eyebrow, Heading, Lede, Slide, Step } from "./primitives";
import { SLIDE_COLOR, SLIDE_SPACE, SLIDE_TYPE } from "./scale";

// The layouts a deck is made of (164): each is a whole slide, filled in
// from props, so a slide is mostly content. Anything they don't cover is
// composed on `Slide` from plain elements.

export interface TitleProps {
  readonly children?: ReactNode;
  readonly eyebrow?: string;
  readonly subtitle?: string;
  readonly title: string;
}

/** The opening slide: the deck's name, large. */
export function Title({ children, eyebrow, subtitle, title }: TitleProps) {
  return (
    <Slide align="center">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Heading size="display">{title}</Heading>
      {subtitle ? <Lede>{subtitle}</Lede> : null}
      {children}
    </Slide>
  );
}

export interface SectionProps {
  /** Its place in the deck, as it reads ("02"). */
  readonly number?: string;
  readonly subtitle?: string;
  readonly title: string;
}

/** A divider between parts of the deck, on the accent colour. */
export function Section({ number, subtitle, title }: SectionProps) {
  return (
    <Slide align="center" tone="inverse">
      {number ? <Eyebrow>{number}</Eyebrow> : null}
      <Heading size="title">{title}</Heading>
      {subtitle ? <Lede>{subtitle}</Lede> : null}
    </Slide>
  );
}

export interface BulletsProps {
  readonly children?: ReactNode;
  readonly items: readonly ReactNode[];
  /** Reveal the items one at a time as the presenter advances. */
  readonly steps?: boolean;
  readonly title: string;
}

/** A heading and up to six points. */
export function Bullets({
  children,
  items,
  steps = false,
  title,
}: BulletsProps) {
  return (
    <Slide>
      <Heading>{title}</Heading>
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: SLIDE_SPACE.sm,
          margin: 0,
          paddingInlineStart: SLIDE_SPACE.md,
        }}
      >
        {items.map((item, index) => {
          const point = (
            // biome-ignore lint/suspicious/noArrayIndexKey: points are a fixed list from props, never reordered.
            <li key={index} style={{ fontSize: SLIDE_TYPE.body }}>
              {item}
            </li>
          );
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          return steps ? <Step key={index}>{point}</Step> : point;
        })}
      </ul>
      {children}
    </Slide>
  );
}

export interface TwoColumnProps {
  readonly left: ReactNode;
  readonly right: ReactNode;
  readonly title: string;
}

/** A heading over two equal columns: a comparison, or words beside a picture. */
export function TwoColumn({ left, right, title }: TwoColumnProps) {
  const column = {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: SLIDE_SPACE.sm,
    minWidth: 0,
  } as const;
  return (
    <Slide>
      <Heading>{title}</Heading>
      <div style={{ display: "flex", flex: 1, gap: SLIDE_SPACE.xl }}>
        <div style={column}>{left}</div>
        <div style={column}>{right}</div>
      </div>
    </Slide>
  );
}

export interface QuoteProps {
  readonly author?: string;
  readonly byline?: string;
  readonly quote: string;
}

/** A quotation, large, and who said it. */
export function Quote({ author, byline, quote }: QuoteProps) {
  return (
    <Slide align="center" tone="muted">
      <blockquote
        style={{
          fontSize: SLIDE_TYPE.heading,
          fontWeight: 500,
          lineHeight: 1.2,
          margin: 0,
          textWrap: "balance",
        }}
      >
        “{quote}”
      </blockquote>
      {author ? (
        <p style={{ fontSize: SLIDE_TYPE.body, margin: 0 }}>
          <strong>{author}</strong>
          {byline ? (
            <span style={{ color: SLIDE_COLOR.mutedForeground }}>
              {" "}
              · {byline}
            </span>
          ) : null}
        </p>
      ) : null}
    </Slide>
  );
}

export interface StatProps {
  readonly detail?: string;
  readonly label: string;
  readonly title?: string;
  /** The number as it reads ("42%", "$1.2M"). */
  readonly value: string;
}

/** One number that matters, very large. */
export function Stat({ detail, label, title, value }: StatProps) {
  return (
    <Slide align="center">
      {title ? <Eyebrow>{title}</Eyebrow> : null}
      <p
        style={{
          color: SLIDE_COLOR.accent,
          fontSize: SLIDE_TYPE.display * 2,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          margin: 0,
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: SLIDE_TYPE.heading, fontWeight: 600, margin: 0 }}>
        {label}
      </p>
      {detail ? <Lede>{detail}</Lede> : null}
    </Slide>
  );
}

export interface ImageSlideProps {
  readonly alt: string;
  readonly caption?: string;
  /** `contain` shows the whole picture; `cover` fills the space. */
  readonly fit?: "contain" | "cover";
  /** A `data:` URL; the runtime loads nothing from the network. */
  readonly src: string;
  readonly title?: string;
}

/** A picture, with an optional heading and caption. */
export function ImageSlide({
  alt,
  caption,
  fit = "contain",
  src,
  title,
}: ImageSlideProps) {
  return (
    <Slide>
      {title ? <Heading>{title}</Heading> : null}
      <figure
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: SLIDE_SPACE.sm,
          margin: 0,
          minHeight: 0,
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: slides render outside any framework's image pipeline. */}
        <img
          alt={alt}
          height={720}
          src={src}
          style={{
            borderRadius: SLIDE_SPACE.sm,
            flex: 1,
            minHeight: 0,
            objectFit: fit,
            width: "100%",
          }}
          width={1632}
        />
        {caption ? (
          <figcaption
            style={{
              color: SLIDE_COLOR.mutedForeground,
              fontSize: SLIDE_TYPE.caption,
            }}
          >
            {caption}
          </figcaption>
        ) : null}
      </figure>
    </Slide>
  );
}

export interface AgendaProps {
  /** The item being presented now, 0-based; it's set apart. */
  readonly current?: number;
  readonly items: readonly string[];
  readonly title?: string;
}

/** What the deck covers, numbered. */
export function Agenda({ current, items, title = "Agenda" }: AgendaProps) {
  return (
    <Slide>
      <Heading>{title}</Heading>
      <ol
        style={{
          display: "flex",
          flexDirection: "column",
          gap: SLIDE_SPACE.sm,
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {items.map((item, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list from props.
            key={index}
            style={{
              alignItems: "baseline",
              color:
                current === undefined || current === index
                  ? SLIDE_COLOR.foreground
                  : SLIDE_COLOR.mutedForeground,
              display: "flex",
              fontSize: SLIDE_TYPE.body,
              fontWeight: current === index ? 700 : 400,
              gap: SLIDE_SPACE.md,
            }}
          >
            <span
              style={{
                color: SLIDE_COLOR.accent,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </Slide>
  );
}

export interface ClosingProps {
  /** How to reach the presenter: an email, a link, a handle. */
  readonly contact?: string;
  readonly subtitle?: string;
  readonly title: string;
}

/** The last slide: thanks, the ask, and how to get in touch. */
export function Closing({ contact, subtitle, title }: ClosingProps) {
  return (
    <Slide align="center" tone="inverse">
      <Heading size="title">{title}</Heading>
      {subtitle ? <Lede>{subtitle}</Lede> : null}
      {contact ? (
        <p style={{ fontSize: SLIDE_TYPE.caption, margin: 0, opacity: 0.85 }}>
          {contact}
        </p>
      ) : null}
    </Slide>
  );
}
