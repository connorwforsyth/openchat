// biome-ignore-all lint/suspicious/noBitwiseOperators: FNV-1a is defined in 32-bit integer operations.
import type { ModelRef } from "@workspace/contract/schemas/models";
import { err, ok } from "@workspace/shared/result";

import type { Embedder } from "./embedder";

// A deterministic Embedder for tests: hashed bag-of-words vectors, unit
// length. Texts that share words land close together under cosine
// similarity, so retrieval tests rank sensibly without a model.

const WORD = /[\p{L}\p{N}]+/gu;

/** FNV-1a: small, stable across runs and platforms. */
const hash = (text: string): number => {
  let value = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01_00_01_93);
  }
  return value >>> 0;
};

export const hashEmbedding = (text: string, dimensions: number): number[] => {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    const h = hash(word);
    const slot = h % dimensions;
    vector[slot] = (vector[slot] ?? 0) + ((h >>> 16) % 2 === 0 ? 1 : -1);
  }
  const length = Math.hypot(...vector);
  return length === 0 ? vector : vector.map((x) => x / length);
};

export const cosineSimilarity = (
  a: readonly number[],
  b: readonly number[]
): number => a.reduce((sum, x, index) => sum + x * (b[index] ?? 0), 0);

export const createHashEmbedder = ({
  dimensions = 64,
  maxBatchSize = 100,
  model = "test:hash-embedding",
}: {
  readonly dimensions?: number;
  readonly maxBatchSize?: number;
  readonly model?: ModelRef;
} = {}): Embedder => ({
  dimensions,
  embed: (values) => {
    if (values.length > maxBatchSize) {
      return Promise.resolve(
        err({
          message: `${values.length} inputs; the limit is ${maxBatchSize}`,
          type: "too_large" as const,
        })
      );
    }
    return Promise.resolve(
      ok({
        embeddings: values.map((value) => hashEmbedding(value, dimensions)),
        usage: {
          tokens: values.reduce(
            (sum, value) => sum + (value.match(WORD)?.length ?? 0),
            0
          ),
        },
      })
    );
  },
  maxBatchSize,
  model,
});
