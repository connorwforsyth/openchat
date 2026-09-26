import { MockEmbeddingModelV4 } from "ai/test";

import { hashEmbedding } from "../ports/embedder.memory";

// An AI SDK embedding model for tests: the hash embedder's vectors behind
// the real `EmbeddingModelV4` interface, so `embedMany` and the adapter run
// for real without a provider. Texts sharing words land close together.

export const createHashEmbeddingModel = ({
  dimensions = 64,
  maxEmbeddingsPerCall = 16,
}: {
  readonly dimensions?: number;
  readonly maxEmbeddingsPerCall?: number;
} = {}): MockEmbeddingModelV4 =>
  new MockEmbeddingModelV4({
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((value) => hashEmbedding(value, dimensions)),
        usage: { tokens: values.length },
        warnings: [],
      }),
    maxEmbeddingsPerCall,
    modelId: "hash-embedding",
    provider: "test",
  });
