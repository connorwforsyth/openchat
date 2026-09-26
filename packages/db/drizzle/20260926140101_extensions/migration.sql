-- pgvector, for file_chunk.embedding. First so every later migration can use
-- the `vector` and `halfvec` types (docs/decisions/0001).
CREATE EXTENSION IF NOT EXISTS vector;
