import { describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  createHashEmbedder,
  hashEmbedding,
} from "./embedder.memory";

describe("hash Embedder", () => {
  const embedder = createHashEmbedder({ dimensions: 32, maxBatchSize: 3 });

  it("returns one unit vector per input, in order", async () => {
    const result = await embedder.embed(["invoice total", "cat pictures"]);
    expect(result.ok).toBe(true);
    const vectors = result.ok ? result.value.embeddings : [];
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(32);
      expect(Math.hypot(...vector)).toBeCloseTo(1);
    }
    expect(result.ok && result.value.usage.tokens).toBe(4);
  });

  it("is deterministic and puts related text closer", () => {
    expect(hashEmbedding("Invoice total", 32)).toEqual(
      hashEmbedding("invoice TOTAL", 32)
    );
    const query = hashEmbedding("invoice total due", 64);
    const related = hashEmbedding("the invoice total is due friday", 64);
    const unrelated = hashEmbedding("pictures of cats sleeping", 64);
    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated)
    );
  });

  it("gives empty text a zero vector rather than NaN", () => {
    expect(hashEmbedding("", 4)).toEqual([0, 0, 0, 0]);
  });

  it("refuses batches over its limit", async () => {
    expect(await embedder.embed(["a", "b", "c", "d"])).toMatchObject({
      error: { type: "too_large" },
      ok: false,
    });
  });
});
