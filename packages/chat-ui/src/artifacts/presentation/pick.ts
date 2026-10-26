import type { SlideTarget } from "@workspace/artifacts-kit/kinds/presentation/edit-target";

import type { PickSource } from "../presentation-preview";
import type { PickedElement } from "../runtime-protocol";

// What the slides editor believes about a pick (n2). The frame that draws
// the deck also runs the deck's own code, which can post a `picked` message
// as well as the runtime can, so a pick is a claim. The editor takes one
// only when it fits what the person did: they clicked in the slide shown
// (the frame has the focus), or it's the element already picked, drawn
// again. Even a taken pick only aims the inspector: every change is made
// here, from the person's input, and shows on the slide at once.
// A pick from a deck drawn before the source changed under the editor (the
// agent's version, undo) is dropped, so a style can't land on the element
// that now sits where the old one was. The frame never sends edits.

/** A pick the editor took, and the source epoch it belongs to. */
export interface Picked {
  readonly element: PickedElement;
  readonly epoch: number;
}

export const sameTarget = (a: SlideTarget, b: SlideTarget): boolean =>
  a.slide === b.slide &&
  a.line === b.line &&
  a.column === b.column &&
  a.part === b.part &&
  a.prop === b.prop;

/** What to do with the frame's pick. */
export type PickDecision = "ignore" | "refresh" | "take";

/**
 * Judges the frame's pick. Pure. Taken: the person clicked in the slide
 * shown (the frame has the focus), including clicking nothing. Refreshed:
 * the element already picked, drawn again, whose styles are news but whose
 * words and kind stay the editor's own. Anything else is ignored: a pick
 * for another slide, from a deck drawn before the source changed, or posted
 * while the person was elsewhere.
 */
export const judgePick = ({
  current,
  epoch,
  focus,
  from,
  incoming,
}: {
  readonly current: Picked | null;
  /** The source epoch now. */
  readonly epoch: number;
  /** The slide shown. */
  readonly focus: string | undefined;
  readonly from: PickSource;
  readonly incoming: PickedElement | null;
}): PickDecision => {
  if (from.epoch !== epoch) {
    return "ignore";
  }
  if (incoming !== null && incoming.target.slide !== focus) {
    return "ignore";
  }
  if (from.focused) {
    return "take";
  }
  return incoming !== null &&
    current !== null &&
    sameTarget(current.element.target, incoming.target)
    ? "refresh"
    : "ignore";
};

/** The pick after the frame's news. Pure. */
export const nextPick = (
  current: Picked | null,
  incoming: PickedElement | null,
  decision: PickDecision,
  epoch: number
): Picked | null => {
  switch (decision) {
    case "ignore":
      return current;
    case "take":
      return incoming ? { element: incoming, epoch } : null;
    case "refresh":
      return current && incoming
        ? {
            ...current,
            element: {
              ...current.element,
              style: incoming.style,
              theme: incoming.theme,
            },
          }
        : current;
    default:
      return decision satisfies never;
  }
};
