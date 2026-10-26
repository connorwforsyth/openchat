import { err, ok, type Result } from "@workspace/shared/result";

import type { ArtifactOperation } from "../../define";
import type { Presentation } from "./content";
import { addSlide, deleteSlide, moveSlide, updateSlide } from "./operations";

// What a person does to a deck in the slides editor's sorter (reorder, add,
// duplicate, delete, notes), as the same pure operations the model's
// `update_artifact` uses. Each says which slide to select afterwards.

export type DeckAction =
  | { readonly after: string | null; readonly type: "add" }
  | { readonly slide: string; readonly type: "delete" }
  | { readonly slide: string; readonly type: "duplicate" }
  | { readonly index: number; readonly slide: string; readonly type: "move" }
  | { readonly notes: string; readonly slide: string; readonly type: "notes" };

export interface DeckActionResult {
  readonly deck: Presentation;
  /** The slide to select afterwards. */
  readonly select: string;
}

/** A new slide's source: a heading and one point, ready to be rewritten. */
export const NEW_SLIDE_SOURCE = `import { Bullets } from "@workspace/slide-ui";

export default function NewSlide() {
  return <Bullets items={["First point"]} title="New slide" />;
}
`;

/** `base`, or `base-2`, `base-3`… whichever no slide has yet. */
export const freeSlideId = (deck: Presentation, base: string): string => {
  const taken = new Set(deck.slides.map((slide) => slide.id));
  // Ids are at most 40 characters; leave room for a suffix.
  const stem = base.slice(0, 34).replace(TRAILING_DASHES, "") || "slide";
  if (!taken.has(stem)) {
    return stem;
  }
  let n = 2;
  while (taken.has(`${stem}-${n}`)) {
    n += 1;
  }
  return `${stem}-${n}`;
};

const TRAILING_DASHES = /-+$/;

const indexOf = (deck: Presentation, id: string): number =>
  deck.slides.findIndex((slide) => slide.id === id);

const run = <TInput>(
  operation: ArtifactOperation<Presentation, TInput>,
  deck: Presentation,
  input: TInput,
  select: string
): Result<DeckActionResult, string> => {
  const [problem] = operation.problems?.(deck, input) ?? [];
  return problem === undefined
    ? ok({ deck: operation.apply(deck, input), select })
    : err(problem);
};

/** Applies `action` to `deck`, or says why it can't. Pure. */
export const applyDeckAction = (
  deck: Presentation,
  action: DeckAction
): Result<DeckActionResult, string> => {
  switch (action.type) {
    case "add": {
      const id = freeSlideId(deck, "slide");
      const at =
        action.after === null
          ? deck.slides.length
          : indexOf(deck, action.after) + 1;
      return run(
        addSlide,
        deck,
        { index: at, slide: id, source: NEW_SLIDE_SOURCE },
        id
      );
    }
    case "duplicate": {
      const at = indexOf(deck, action.slide);
      const original = deck.slides[at];
      if (!original) {
        return err(`there's no slide "${action.slide}"`);
      }
      const id = freeSlideId(deck, `${original.id}-copy`);
      return run(
        addSlide,
        deck,
        {
          index: at + 1,
          slide: id,
          source: original.source,
          ...(original.notes === undefined ? {} : { notes: original.notes }),
        },
        id
      );
    }
    case "delete": {
      const at = indexOf(deck, action.slide);
      const neighbour =
        deck.slides[at + 1]?.id ?? deck.slides[at - 1]?.id ?? action.slide;
      return run(deleteSlide, deck, { slide: action.slide }, neighbour);
    }
    case "move":
      return run(
        moveSlide,
        deck,
        { index: action.index, slide: action.slide },
        action.slide
      );
    case "notes":
      return run(
        updateSlide,
        deck,
        { notes: action.notes, slide: action.slide },
        action.slide
      );
    default:
      return action satisfies never;
  }
};
