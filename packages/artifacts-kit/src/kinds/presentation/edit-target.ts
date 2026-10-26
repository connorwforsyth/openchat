import { z } from "zod";

import { slideIdSchema } from "./content";
import type { DeckVisualEdit } from "./visual-edits";

// What the slides editor picks and changes, apart from the edit engine
// (`./visual-edits`): the host's frame protocol and the editor parse these
// without loading the engine, which needs Node's `process` and a parser.

// Ops land in source as an object key, so a key that isn't an identifier
// would be code.
export const styleKeySchema = z.string().regex(/^[A-Za-z_$][\w$]*$/);
export const offsetSchema = z.number().int().min(0);
/** An attribute (`title`), or one element of an array attribute (`items.2`). */
export const propPathSchema = z.string().regex(/^[A-Za-z_$][\w$-]*(?:\.\d+)?$/);

/**
 * What a click in the slides editor picked: an element written in a
 * slide's source, at its stamp, or one part of a slide-ui layout there
 * (`part` names it in the layout's `styles`; `prop` is where its text
 * comes from, like `title` or `items.2`).
 */
export const slideTargetSchema = z.object({
  column: offsetSchema,
  line: z.number().int().min(1),
  part: styleKeySchema.optional(),
  prop: propPathSchema.optional(),
  slide: slideIdSchema,
});
export type SlideTarget = z.infer<typeof slideTargetSchema>;

/** What a person changed about the element they picked. */
export type SlideChange =
  | {
      readonly key: string;
      readonly kind: "style";
      readonly value: string | null;
    }
  | {
      readonly kind: "text";
      /** The text before, so the edit lands on the element that showed it. */
      readonly previous: string;
      readonly value: string;
    };

/** The edit that makes `change` to `target`. Pure. */
export const editFor = (
  target: SlideTarget,
  change: SlideChange
): DeckVisualEdit => {
  const at = { column: target.column, line: target.line, slide: target.slide };
  if (change.kind === "style") {
    return {
      ...at,
      ops: [
        target.part === undefined
          ? { key: change.key, kind: "set-style", value: change.value }
          : {
              key: change.key,
              kind: "set-part-style",
              part: target.part,
              value: change.value,
            },
      ],
    };
  }
  return {
    ...at,
    ops: [
      target.prop === undefined
        ? { kind: "set-text", prevText: change.previous, value: change.value }
        : {
            kind: "set-prop",
            prevText: change.previous,
            prop: target.prop,
            value: change.value,
          },
    ],
  };
};
