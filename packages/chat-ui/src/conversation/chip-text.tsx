"use client";

import { type PlacedChip, segmentText } from "@workspace/ai/messages/chips";
import { Chip } from "@workspace/composer/components/chip";

/**
 * A sent message's text with its chips drawn as they were in the composer:
 * `@Researcher` shows as the agent's chip, `@Slides` as the artifact type's.
 */
export function ChipText({
  chips,
  text,
}: {
  readonly chips: readonly PlacedChip[];
  readonly text: string;
}) {
  return segmentText(text, chips).map((segment) =>
    segment.kind === "text" ? (
      segment.text
    ) : (
      <Chip
        artifact={
          segment.chip.kind === "artifact" ? segment.chip.artifact : undefined
        }
        draft={
          (segment.chip.kind === "agent" || segment.chip.kind === "skill") &&
          segment.chip.versionId !== undefined
        }
        key={segment.chip.start}
        kind={segment.chip.kind}
        label={segment.chip.label}
      />
    )
  );
}
