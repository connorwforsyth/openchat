import { z } from "zod";

// What a Presentation version stores (164). `artifact_version.content` is
// text, so a deck is JSON text of this shape:
//
//   { "title": "Q3 review",
//     "slides": [{ "id": "intro", "source": "import { Title } from …", "notes": "…" }] }
//
// Each slide's `source` is TSX that default-exports one 1920×1080 slide,
// built from `@workspace/slide-ui`. Slides are named by `id`, so the model
// edits one slide (`update_slide`) rather than sending the whole deck.

export const PRESENTATION_LIMITS = {
  /** All of the deck's text together, as the artifact tools cap content. */
  chars: 400_000,
  notes: 5000,
  slides: 60,
  source: 40_000,
} as const;

/** The canvas every slide is drawn on, in CSS pixels. */
export const SLIDE_SIZE = { height: 1080, width: 1920 } as const;

const SLIDE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const slideIdSchema = z
  .string()
  .regex(
    SLIDE_ID,
    'isn\'t a slide id: use lower-case letters, digits and dashes, like "intro" or "q3-results"'
  );

export const slideSchema = z.object({
  id: slideIdSchema,
  notes: z.string().max(PRESENTATION_LIMITS.notes).optional(),
  source: z.string().min(1).max(PRESENTATION_LIMITS.source),
});
export type Slide = z.infer<typeof slideSchema>;

export const presentationSchema = z.object({
  slides: z.array(slideSchema),
  title: z.string().max(200),
});
export type Presentation = z.infer<typeof presentationSchema>;

/**
 * A presentation version as stored: JSON text of `presentationSchema`.
 * Text that isn't JSON fails with one problem the model can act on.
 */
export const presentationContentSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({
        code: "custom",
        message:
          'isn\'t JSON. A presentation is {"title": "…", "slides": [{"id": "intro", "source": "…"}]}',
      });
      return z.NEVER;
    }
  })
  .pipe(presentationSchema);

/** The deck as the JSON text a version stores. */
export const presentationText = (deck: Presentation): string =>
  JSON.stringify(deck);

/** The file a slide's elements are stamped with (`data-src`, D16). */
export const slideFileName = (id: string): string => `slides/${id}.tsx`;
