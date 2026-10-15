import { z } from "zod";

import { defineOperation } from "../../define";
import {
  PRESENTATION_LIMITS,
  type Presentation,
  presentationContentSchema,
  type Slide,
  slideIdSchema,
} from "./content";

// How the model edits a deck without sending all of it (164): a slide at a
// time, named by its id. Whole-deck `replace` is the fallback. Each is pure;
// `problems` says why one can't apply (no such slide, a position past the
// end) before `apply` runs.

const EMPTY: Presentation = { slides: [], title: "" };

const slideInput = slideIdSchema.describe("The slide's id.");
const sourceInput = z
  .string()
  .min(1)
  .max(PRESENTATION_LIMITS.source)
  .describe("The slide's TSX: one default-exported 1920×1080 slide.");
const notesInput = z
  .string()
  .max(PRESENTATION_LIMITS.notes)
  .describe("Speaker notes for the slide.");
const indexInput = z
  .number()
  .int()
  .describe("A 0-based position in the deck: 0 is the first slide.");

const idsOf = (deck: Presentation): string =>
  deck.slides.map((slide) => `"${slide.id}"`).join(", ");

const unknownSlide = (deck: Presentation, id: string): string =>
  deck.slides.length > 0
    ? `there's no slide "${id}". Its slides: ${idsOf(deck)}`
    : `there's no slide "${id}": the presentation has no slides yet`;

const has = (deck: Presentation | null, id: string): boolean =>
  (deck ?? EMPTY).slides.some((slide) => slide.id === id);

const withSlides = (
  deck: Presentation,
  slides: readonly Slide[]
): Presentation => ({ ...deck, slides: [...slides] });

/** The whole deck again, as the JSON a version stores. */
export const replacePresentation = defineOperation({
  apply: (
    _current: Presentation | null,
    input: { readonly content: Presentation }
  ) => input.content,
  description: "Replace the whole presentation.",
  input: z.object({ content: presentationContentSchema }),
});

/** A new slide, at `index` or at the end. */
export const addSlide = defineOperation({
  apply: (
    current: Presentation | null,
    input: {
      readonly index?: number;
      readonly notes?: string;
      readonly slide: string;
      readonly source: string;
    }
  ) => {
    const deck = current ?? EMPTY;
    const at = input.index ?? deck.slides.length;
    const slide: Slide = {
      id: input.slide,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      source: input.source,
    };
    return withSlides(deck, [
      ...deck.slides.slice(0, at),
      slide,
      ...deck.slides.slice(at),
    ]);
  },
  description: "Add a slide, at index or at the end.",
  input: z.object({
    index: indexInput.optional(),
    notes: notesInput.optional(),
    slide: slideInput,
    source: sourceInput,
  }),
  problems: (current, input) => {
    const deck = current ?? EMPTY;
    return [
      ...(has(deck, input.slide)
        ? [
            `there's already a slide "${input.slide}": give the new slide another id, or use update_slide`,
          ]
        : []),
      ...(input.index !== undefined &&
      (input.index < 0 || input.index > deck.slides.length)
        ? [
            `index ${input.index} isn't a position in the deck: use 0 to ${deck.slides.length}, or leave it out to add at the end`,
          ]
        : []),
    ];
  },
});

/** One slide's source, notes, or both. */
export const updateSlide = defineOperation({
  apply: (
    current: Presentation | null,
    input: {
      readonly notes?: string;
      readonly slide: string;
      readonly source?: string;
    }
  ) => {
    const deck = current ?? EMPTY;
    return withSlides(
      deck,
      deck.slides.map((slide) =>
        slide.id === input.slide
          ? {
              ...slide,
              ...(input.source === undefined ? {} : { source: input.source }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            }
          : slide
      )
    );
  },
  description: "Change one slide's source or notes.",
  input: z.object({
    notes: notesInput.optional(),
    slide: slideInput,
    source: sourceInput.optional(),
  }),
  problems: (current, input) => [
    ...(has(current, input.slide)
      ? []
      : [unknownSlide(current ?? EMPTY, input.slide)]),
    ...(input.source === undefined && input.notes === undefined
      ? ["update_slide needs a source, notes, or both"]
      : []),
  ],
});

/** A slide to another position. */
export const moveSlide = defineOperation({
  apply: (
    current: Presentation | null,
    input: { readonly index: number; readonly slide: string }
  ) => {
    const deck = current ?? EMPTY;
    const moving = deck.slides.find((slide) => slide.id === input.slide);
    if (!moving) {
      return deck;
    }
    const rest = deck.slides.filter((slide) => slide.id !== input.slide);
    return withSlides(deck, [
      ...rest.slice(0, input.index),
      moving,
      ...rest.slice(input.index),
    ]);
  },
  description: "Move a slide to index.",
  input: z.object({ index: indexInput, slide: slideInput }),
  problems: (current, input) => {
    const deck = current ?? EMPTY;
    if (!has(deck, input.slide)) {
      return [unknownSlide(deck, input.slide)];
    }
    const last = deck.slides.length - 1;
    return input.index < 0 || input.index > last
      ? [`index ${input.index} isn't a position in the deck: use 0 to ${last}`]
      : [];
  },
});

/** A slide, gone. */
export const deleteSlide = defineOperation({
  apply: (current: Presentation | null, input: { readonly slide: string }) => {
    const deck = current ?? EMPTY;
    return withSlides(
      deck,
      deck.slides.filter((slide) => slide.id !== input.slide)
    );
  },
  description: "Delete a slide.",
  input: z.object({ slide: slideInput }),
  problems: (current, input) => {
    const deck = current ?? EMPTY;
    if (!has(deck, input.slide)) {
      return [unknownSlide(deck, input.slide)];
    }
    return deck.slides.length === 1
      ? [
          "that's the only slide, and a presentation needs one: replace it with update_slide instead",
        ]
      : [];
  },
});

/** The presentation's edits, by the name `update_artifact` sends. */
export const PRESENTATION_EDITS = {
  add_slide: addSlide,
  delete_slide: deleteSlide,
  move_slide: moveSlide,
  replace: replacePresentation,
  update_slide: updateSlide,
} as const;
