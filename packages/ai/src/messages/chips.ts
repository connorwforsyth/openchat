import {
  libraryItemIdSchema,
  libraryVersionIdSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import {
  type ArtifactKind,
  artifactKindSchema,
  type MessagePart,
} from "@workspace/contract/schemas/message-parts";
import { z } from "zod";

// The chips a message was written with: what the composer's `/` and `@`
// menu put in the text (an agent, a skill, an artifact type, a person, a
// workspace file). Each sits in the text as `@label`; this part says where
// and what it stands for, so the sent message shows them as chips and the
// server acts on them. The contract leaves a data part's shape to the
// feature that sends it, so this is that shape.
//
// What the server does with each: an agent chip answers the message (the
// run's target), an artifact chip asks for that kind. Skill chips also go
// as `input.skills`, which the server resolves and records (127).

/** The data part name: `data-chips` in AI SDK terms. */
export const CHIPS_DATA = "chips";

const labelSchema = z.string().trim().min(1).max(200);

export const chipSchema = z.discriminatedUnion("kind", [
  z.object({
    id: libraryItemIdSchema,
    kind: z.literal("agent"),
    label: labelSchema,
    /** The owner's unpublished draft; absent means the latest published version. */
    versionId: libraryVersionIdSchema.optional(),
  }),
  z.object({
    id: libraryItemIdSchema,
    kind: z.literal("skill"),
    label: labelSchema,
    versionId: libraryVersionIdSchema.optional(),
  }),
  z.object({
    artifact: artifactKindSchema,
    kind: z.literal("artifact"),
    label: labelSchema,
  }),
  z.object({ id: userIdSchema, kind: z.literal("user"), label: labelSchema }),
  z.object({
    kind: z.literal("file"),
    label: labelSchema,
    path: z.string().min(1).max(1024),
  }),
]);
export type Chip = z.infer<typeof chipSchema>;
export type ChipKind = Chip["kind"];

const placed = { end: z.int().min(1), start: z.int().min(0) };

/** A chip as it sits in the text: `text.slice(start, end)` is `@label`. */
export const placedChipSchema = z.discriminatedUnion("kind", [
  chipSchema.options[0].extend(placed),
  chipSchema.options[1].extend(placed),
  chipSchema.options[2].extend(placed),
  chipSchema.options[3].extend(placed),
  chipSchema.options[4].extend(placed),
]);
export type PlacedChip = z.infer<typeof placedChipSchema>;

export const chipsDataSchema = z.object({
  chips: z.array(placedChipSchema).min(1).max(50),
});
export type ChipsData = z.infer<typeof chipsDataSchema>;

/** The chips a message's parts carry, in text order. Pure. */
export const chipsOf = (
  parts: readonly Pick<MessagePart, "type">[]
): readonly PlacedChip[] =>
  parts.flatMap((part) => {
    if (part.type !== "data") {
      return [];
    }
    const data = part as Extract<MessagePart, { type: "data" }>;
    if (data.name !== CHIPS_DATA) {
      return [];
    }
    const parsed = chipsDataSchema.safeParse(data.data);
    return parsed.success ? parsed.data.chips : [];
  });

/**
 * The agent a message's chips ask to answer: the last agent chip, as in
 * "ask @Researcher, no, @Writer". `undefined` when there's none.
 */
export const answeringAgent = (
  chips: readonly PlacedChip[]
): Extract<Chip, { kind: "agent" }> | undefined =>
  chips
    .filter(
      (chip): chip is Extract<PlacedChip, { kind: "agent" }> =>
        chip.kind === "agent"
    )
    .at(-1);

/** The artifact kinds a message's chips ask for, once each. Pure. */
export const requestedArtifacts = (
  chips: readonly PlacedChip[]
): readonly ArtifactKind[] => [
  ...new Set(
    chips.flatMap((chip) => (chip.kind === "artifact" ? [chip.artifact] : []))
  ),
];

export type TextSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly chip: PlacedChip; readonly kind: "chip" };

/**
 * `text` cut into plain runs and chips, for drawing a sent message. A chip
 * whose place doesn't hold `@label` (the text was edited, the part is from
 * elsewhere) stays plain text. Pure.
 */
export const segmentText = (
  text: string,
  chips: readonly PlacedChip[]
): readonly TextSegment[] => {
  const segments: TextSegment[] = [];
  let at = 0;
  const sorted = [...chips].sort((a, b) => a.start - b.start);
  for (const chip of sorted) {
    if (
      chip.start < at ||
      text.slice(chip.start, chip.end) !== `@${chip.label}`
    ) {
      continue;
    }
    if (chip.start > at) {
      segments.push({ kind: "text", text: text.slice(at, chip.start) });
    }
    segments.push({ chip, kind: "chip" });
    at = chip.end;
  }
  if (at < text.length) {
    segments.push({ kind: "text", text: text.slice(at) });
  }
  return segments;
};

/**
 * The chips still in `text` after it was edited as plain text: each one
 * whose `@label` is still there, in order, at its new place. One whose
 * `@label` was removed is dropped. Pure.
 */
export const replaceChips = (
  text: string,
  chips: readonly PlacedChip[]
): readonly PlacedChip[] => {
  const kept: PlacedChip[] = [];
  let from = 0;
  for (const chip of [...chips].sort((a, b) => a.start - b.start)) {
    const start = text.indexOf(`@${chip.label}`, from);
    if (start === -1) {
      continue;
    }
    const end = start + chip.label.length + 1;
    kept.push({ ...chip, end, start });
    from = end;
  }
  return kept;
};
