import { isDeepStrictEqual } from "node:util";
import {
  type JsonValue,
  jsonValueSchema,
} from "@workspace/contract/schemas/common";
import { z } from "zod";

// Adjacent text and reasoning deltas, merged before a batch of run chunks is
// stored (145, after T3 Code's live-event coalescer). A token stream is
// mostly `text-delta`s for one part, so a batch of them becomes one row: far
// fewer rows and NOTIFYs, and a resume from 0 replays far less. The AI SDK
// appends each delta's text to its part, so one delta carrying "ab" renders
// exactly as "a" then "b".

const deltaChunkSchema = z
  .object({
    delta: z.string(),
    id: z.string(),
    type: z.enum(["text-delta", "reasoning-delta"]),
  })
  .catchall(jsonValueSchema);
type DeltaChunk = z.infer<typeof deltaChunkSchema>;

export interface CoalescedChunk {
  /** How many consecutive input chunks this one holds (1 when unmerged). */
  readonly count: number;
  readonly payload: JsonValue;
}

const asDelta = (payload: JsonValue): DeltaChunk | null => {
  const parsed = deltaChunkSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

const withoutDelta = ({ delta: _delta, ...rest }: DeltaChunk) => rest;

/**
 * Two deltas merge only when nothing is lost: same type, same part `id`,
 * and every other field (`providerMetadata`, say) identical, since the AI
 * SDK sets those on the part per chunk.
 */
const mergeable = (previous: DeltaChunk, next: DeltaChunk): boolean =>
  isDeepStrictEqual(withoutDelta(previous), withoutDelta(next));

/**
 * The chunks to store for one batch: runs of mergeable deltas become one
 * delta with their text joined; everything else passes through as it was,
 * in order.
 */
export const coalesceDeltas = (
  payloads: readonly JsonValue[]
): readonly CoalescedChunk[] => {
  const out: CoalescedChunk[] = [];
  // The last output chunk, when it's a delta another can still join.
  let tail: DeltaChunk | null = null;
  for (const payload of payloads) {
    const delta = asDelta(payload);
    const last = out.at(-1);
    if (delta && tail && last && mergeable(tail, delta)) {
      const merged: DeltaChunk = { ...tail, delta: tail.delta + delta.delta };
      out[out.length - 1] = { count: last.count + 1, payload: merged };
      tail = merged;
    } else {
      out.push({ count: 1, payload });
      tail = delta;
    }
  }
  return out;
};
