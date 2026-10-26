import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";
import {
  type Presentation,
  type Slide,
  slideIdSchema,
  slideSchema,
} from "./content";
import { offsetSchema, propPathSchema, styleKeySchema } from "./edit-target";
import { applyEditBatch } from "./editing/batch-edit";

// Visual edits to a slide's TSX (the slides editor): a click in the rendered
// slide names an element by its `data-src` stamp, and each op rewrites that
// element's source in place. The engine is open-slide's (./editing).

export const visualEditOpSchema = z.discriminatedUnion("kind", [
  z.object({
    key: styleKeySchema,
    kind: z.literal("set-style"),
    prevText: z.string().optional(),
    value: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("set-text"),
    prevText: z.string().optional(),
    value: z.string(),
  }),
  z.object({
    end: offsetSchema,
    key: styleKeySchema,
    kind: z.literal("set-text-range-style"),
    prevText: z.string().optional(),
    start: offsetSchema,
    value: z.string().nullable(),
  }),
  // A slide-ui layout's part (its title, its points), through `styles`.
  z.object({
    key: styleKeySchema,
    kind: z.literal("set-part-style"),
    part: styleKeySchema,
    value: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("set-prop"),
    prevText: z.string().optional(),
    /** An attribute (`title`), or one element of an array attribute (`items.2`). */
    prop: propPathSchema,
    value: z.string(),
  }),
]);
export type VisualEditOp = z.infer<typeof visualEditOpSchema>;

export const visualEditSchema = z.object({
  /** Babel's 0-based column of the element's `<`, as stamped. */
  column: offsetSchema,
  /** An earlier edit's index whose target this edit follows. */
  dependsOn: offsetSchema.optional(),
  /** 1-based. */
  line: z.number().int().min(1),
  ops: z.array(visualEditOpSchema).readonly(),
});
export type VisualEdit = z.infer<typeof visualEditSchema>;

export const deckVisualEditSchema = visualEditSchema.extend({
  slide: slideIdSchema,
});
export type DeckVisualEdit = z.infer<typeof deckVisualEditSchema>;

export interface VisualEditResult {
  readonly error?: string;
  readonly ok: boolean;
}

/** Applies `edits` in order; each result says whether its edit landed. */
export const applyVisualEdits = (
  source: string,
  edits: readonly VisualEdit[]
): { readonly results: readonly VisualEditResult[]; readonly source: string } =>
  applyEditBatch(source, edits);

/**
 * Applies the edits slide by slide. A `dependsOn` indexes `edits` and must
 * name an earlier edit to the same slide. Any failure fails the whole deck,
 * with every problem.
 */
export const applyDeckVisualEdits = (
  deck: Presentation,
  edits: readonly DeckVisualEdit[]
): Result<Presentation, readonly string[]> => {
  const problems: string[] = [];
  const bySlide = new Map<string, { index: number; edit: DeckVisualEdit }[]>();
  edits.forEach((edit, index) => {
    if (deck.slides.some((slide) => slide.id === edit.slide)) {
      bySlide.set(edit.slide, [
        ...(bySlide.get(edit.slide) ?? []),
        { edit, index },
      ]);
    } else {
      problems.push(`edit ${index}: there's no slide "${edit.slide}"`);
    }
  });

  const slides = deck.slides.map((slide): Slide => {
    const group = bySlide.get(slide.id);
    if (!group) {
      return slide;
    }
    const local = new Map(group.map(({ index }, at) => [index, at]));
    const batch = group.map(({ edit, index }) => {
      const { dependsOn: across, slide: _, ...rest } = edit;
      if (across === undefined) {
        return rest;
      }
      const dependsOn = local.get(across);
      if (dependsOn === undefined) {
        problems.push(
          `slide "${slide.id}", edit ${index}: depends on edit ${across}, which isn't an edit to this slide`
        );
        return { ...rest, ops: [] };
      }
      return { ...rest, dependsOn };
    });
    const applied = applyEditBatch(slide.source, batch);
    applied.results.forEach((result, at) => {
      if (!result.ok) {
        problems.push(
          `slide "${slide.id}", edit ${group[at]?.index}: ${result.error ?? "failed"}`
        );
      }
    });
    const next = { ...slide, source: applied.source };
    const checked = slideSchema.safeParse(next);
    if (!checked.success) {
      problems.push(
        `slide "${slide.id}": ${checked.error.issues[0]?.message ?? "is invalid after the edits"}`
      );
    }
    return next;
  });

  return problems.length > 0 ? err(problems) : ok({ ...deck, slides });
};
