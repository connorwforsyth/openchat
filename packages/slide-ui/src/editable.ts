import type { CSSProperties } from "react";

// What makes a layout editable in the slides editor (n2). A click in a
// drawn slide is mapped back to the slide's source: the runtime stamps the
// layout's element with where it's written (`data-src`), the layout draws
// that stamp on its root, and marks each part it draws (`data-part`) and the
// prop its words come from (`data-prop`). Styling a part writes the
// layout's `styles` prop, which the layout lays over its own.

/** Styles for a layout's parts, by part, laid over the layout's own. */
export type PartStyles<TPart extends string> = Readonly<
  Partial<Record<TPart, CSSProperties>>
>;

export interface Editable<TPart extends string> {
  /** Where the slide's source wrote this element, as the runtime stamps it. */
  readonly "data-src"?: string;
  readonly styles?: PartStyles<TPart>;
}

/** The attributes that mark a part, and the prop its words come from. */
export const partOf = (
  part: string,
  prop?: string
): Readonly<Record<string, string>> =>
  prop === undefined
    ? { "data-part": part }
    : { "data-part": part, "data-prop": prop };
