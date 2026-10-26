import type { ReactNode } from "react";

import { type Editable, partOf } from "./editable";
import { pointsOf } from "./points";
import { Eyebrow, Heading, Lede, Slide, Step } from "./primitives";
import { SLIDE_COLOR, SLIDE_SPACE, SLIDE_TYPE } from "./scale";

// The layouts a deck is made of (164): each is a whole slide, filled in
// from props, so a slide is mostly content. Anything they don't cover is
// composed on `Slide` from plain elements.

export interface TitleProps
  extends Editable<"eyebrow" | "slide" | "subtitle" | "title"> {
  readonly children?: ReactNode;
  readonly eyebrow?: string;
  readonly subtitle?: string;
  readonly title: string;
}

/** The opening slide: the deck's name, large. */
export function Title({
  children,
  "data-src": source,
  eyebrow,
  styles,
  subtitle,
  title,
}: TitleProps) {
  return (
    <Slide align="center" data-src={source} styles={styles}>
      {eyebrow ? (
        <Eyebrow part="eyebrow" prop="eyebrow" style={styles?.eyebrow}>
          {eyebrow}
        </Eyebrow>
      ) : null}
      <Heading part="title" prop="title" size="display" style={styles?.title}>
        {title}
      </Heading>
      {subtitle ? (
        <Lede part="subtitle" prop="subtitle" style={styles?.subtitle}>
          {subtitle}
        </Lede>
      ) : null}
      {children}
    </Slide>
  );
}

export interface SectionProps
  extends Editable<"number" | "slide" | "subtitle" | "title"> {
  /** Its place in the deck, as it reads ("02"). */
  readonly number?: string;
  readonly subtitle?: string;
  readonly title: string;
}

/** A divider between parts of the deck, on the accent colour. */
export function Section({
  "data-src": source,
  number,
  styles,
  subtitle,
  title,
}: SectionProps) {
  return (
    <Slide align="center" data-src={source} styles={styles} tone="inverse">
      {number ? (
        <Eyebrow part="number" prop="number" style={styles?.number}>
          {number}
        </Eyebrow>
      ) : null}
      <Heading part="title" prop="title" size="title" style={styles?.title}>
        {title}
      </Heading>
      {subtitle ? (
        <Lede part="subtitle" prop="subtitle" style={styles?.subtitle}>
          {subtitle}
        </Lede>
      ) : null}
    </Slide>
  );
}

export interface BulletsProps extends Editable<"items" | "slide" | "title"> {
  readonly children?: ReactNode;
  readonly items: readonly ReactNode[];
  /** Reveal the items one at a time as the presenter advances. */
  readonly steps?: boolean;
  readonly title: string;
}

/** A heading and up to six points. */
export function Bullets({
  children,
  "data-src": source,
  items,
  steps = false,
  styles,
  title,
}: BulletsProps) {
  return (
    <Slide data-src={source} styles={styles}>
      <Heading part="title" prop="title" style={styles?.title}>
        {title}
      </Heading>
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: SLIDE_SPACE.sm,
          margin: 0,
          paddingInlineStart: SLIDE_SPACE.md,
        }}
      >
        {pointsOf(items).map((item, index) => {
          const point = (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: points are a fixed list from props, never reordered.
              key={index}
              {...partOf("items", `items.${index}`)}
              style={{ fontSize: SLIDE_TYPE.body, ...styles?.items }}
            >
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

export interface TwoColumnProps extends Editable<"slide" | "title"> {
  readonly left: ReactNode;
  readonly right: ReactNode;
  readonly title: string;
}

/** A heading over two equal columns: a comparison, or words beside a picture. */
export function TwoColumn({
  "data-src": source,
  left,
  right,
  styles,
  title,
}: TwoColumnProps) {
  const column = {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: SLIDE_SPACE.sm,
    minWidth: 0,
  } as const;
  return (
    <Slide data-src={source} styles={styles}>
      <Heading part="title" prop="title" style={styles?.title}>
        {title}
      </Heading>
      <div style={{ display: "flex", flex: 1, gap: SLIDE_SPACE.xl }}>
        <div style={column}>{left}</div>
        <div style={column}>{right}</div>
      </div>
    </Slide>
  );
}

export interface QuoteProps
  extends Editable<"author" | "byline" | "quote" | "slide"> {
  readonly author?: string;
  readonly byline?: string;
  readonly quote: string;
}

/** A quotation, large, and who said it. */
export function Quote({
  author,
  byline,
  "data-src": source,
  quote,
  styles,
}: QuoteProps) {
  return (
    <Slide align="center" data-src={source} styles={styles} tone="muted">
      <blockquote
        {...partOf("quote")}
        style={{
          fontSize: SLIDE_TYPE.heading,
          fontWeight: 500,
          lineHeight: 1.2,
          margin: 0,
          textWrap: "balance",
          ...styles?.quote,
        }}
      >
        “<span {...partOf("quote", "quote")}>{quote}</span>”
      </blockquote>
      {author ? (
        <p style={{ fontSize: SLIDE_TYPE.body, margin: 0 }}>
          <strong {...partOf("author", "author")} style={styles?.author}>
            {author}
          </strong>
          {byline ? (
            <span style={{ color: SLIDE_COLOR.mutedForeground }}>
              {" "}
              ·{" "}
              <span {...partOf("byline", "byline")} style={styles?.byline}>
                {byline}
              </span>
            </span>
          ) : null}
        </p>
      ) : null}
    </Slide>
  );
}

export interface StatProps
  extends Editable<"detail" | "label" | "slide" | "title" | "value"> {
  readonly detail?: string;
  readonly label: string;
  readonly title?: string;
  /** The number as it reads ("42%", "$1.2M"). */
  readonly value: string;
}

/** One number that matters, very large. */
export function Stat({
  "data-src": source,
  detail,
  label,
  styles,
  title,
  value,
}: StatProps) {
  return (
    <Slide align="center" data-src={source} styles={styles}>
      {title ? (
        <Eyebrow part="title" prop="title" style={styles?.title}>
          {title}
        </Eyebrow>
      ) : null}
      <p
        {...partOf("value", "value")}
        style={{
          color: SLIDE_COLOR.accent,
          fontSize: SLIDE_TYPE.display * 2,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          margin: 0,
          ...styles?.value,
        }}
      >
        {value}
      </p>
      <p
        {...partOf("label", "label")}
        style={{
          fontSize: SLIDE_TYPE.heading,
          fontWeight: 600,
          margin: 0,
          ...styles?.label,
        }}
      >
        {label}
      </p>
      {detail ? (
        <Lede part="detail" prop="detail" style={styles?.detail}>
          {detail}
        </Lede>
      ) : null}
    </Slide>
  );
}

export interface ImageSlideProps
  extends Editable<"caption" | "image" | "slide" | "title"> {
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
  "data-src": source,
  fit = "contain",
  src,
  styles,
  title,
}: ImageSlideProps) {
  return (
    <Slide data-src={source} styles={styles}>
      {title ? (
        <Heading part="title" prop="title" style={styles?.title}>
          {title}
        </Heading>
      ) : null}
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
          {...partOf("image")}
          style={{
            borderRadius: SLIDE_SPACE.sm,
            flex: 1,
            minHeight: 0,
            objectFit: fit,
            width: "100%",
            ...styles?.image,
          }}
          width={1632}
        />
        {caption ? (
          <figcaption
            {...partOf("caption", "caption")}
            style={{
              color: SLIDE_COLOR.mutedForeground,
              fontSize: SLIDE_TYPE.caption,
              ...styles?.caption,
            }}
          >
            {caption}
          </figcaption>
        ) : null}
      </figure>
    </Slide>
  );
}

export interface AgendaProps extends Editable<"items" | "slide" | "title"> {
  /** The item being presented now, 0-based; it's set apart. */
  readonly current?: number;
  readonly items: readonly string[];
  readonly title?: string;
}

/** What the deck covers, numbered. */
export function Agenda({
  current,
  "data-src": source,
  items,
  styles,
  title = "Agenda",
}: AgendaProps) {
  return (
    <Slide data-src={source} styles={styles}>
      <Heading part="title" prop="title" style={styles?.title}>
        {title}
      </Heading>
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
        {pointsOf(items).map((item, index) => (
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
            <span {...partOf("items", `items.${index}`)} style={styles?.items}>
              {item}
            </span>
          </li>
        ))}
      </ol>
    </Slide>
  );
}

export interface ClosingProps
  extends Editable<"contact" | "slide" | "subtitle" | "title"> {
  /** How to reach the presenter: an email, a link, a handle. */
  readonly contact?: string;
  readonly subtitle?: string;
  readonly title: string;
}

/** The last slide: thanks, the ask, and how to get in touch. */
export function Closing({
  contact,
  "data-src": source,
  styles,
  subtitle,
  title,
}: ClosingProps) {
  return (
    <Slide align="center" data-src={source} styles={styles} tone="inverse">
      <Heading part="title" prop="title" size="title" style={styles?.title}>
        {title}
      </Heading>
      {subtitle ? (
        <Lede part="subtitle" prop="subtitle" style={styles?.subtitle}>
          {subtitle}
        </Lede>
      ) : null}
      {contact ? (
        <p
          {...partOf("contact", "contact")}
          style={{
            fontSize: SLIDE_TYPE.caption,
            margin: 0,
            opacity: 0.85,
            ...styles?.contact,
          }}
        >
          {contact}
        </p>
      ) : null}
    </Slide>
  );
}
