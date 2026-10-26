import type { SlideTarget } from "@workspace/artifacts-kit/kinds/presentation/edit-target";

import type { PickSource } from "../presentation-preview";
import type { PickedElement } from "../runtime-protocol";

// What the slides editor believes about a pick (n2). The frame that draws
// the deck also runs the deck's own code, which can post a `picked` message
// as well as the runtime can, so a pick is a claim. The editor takes one
// only when it fits what the person did: they clicked in the slide (the
// frame has the focus), or it's the element already picked, drawn again.
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

/** Whether to take the frame's pick. Pure. */
export const acceptPick = ({
  current,
  epoch,
  from,
  incoming,
}: {
  readonly current: Picked | null;
  /** The source epoch now. */
  readonly epoch: number;
  readonly from: PickSource;
  readonly incoming: PickedElement | null;
}): boolean => {
  if (from.epoch !== epoch) {
    return false;
  }
  if (incoming === null || from.focused) {
    return true;
  }
  return (
    current !== null && sameTarget(current.element.target, incoming.target)
  );
};
