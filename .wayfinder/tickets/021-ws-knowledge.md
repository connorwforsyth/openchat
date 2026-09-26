---
id: "021"
title: "WS-knowledge: files, RAG and search"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["011","013"]
---

## Question

File upload and storage drivers (local and S3-compatible), parsing, chunking, embeddings
into pgvector as pg-boss jobs, the `file_search` tool, full-text chat search, and web search
(provider-native, otherwise our tool with the SearXNG backend) (`PLAN.md` D23, §8 RAG).

## Owns

`packages/ai/src/rag/`, `packages/ai/src/search/`, storage in `packages/server`.

## Done when

An uploaded PDF becomes searchable; chat search finds a message; web search works against
a mocked backend.

## Resolution (2026-09-27, loop)

Merged in [PR #15](https://github.com/connorwforsyth/openchat/pull/15): storage (local volume with HMAC-signed URLs; S3-compatible via `aws4fetch`), RAG (`chunkDocument`, unpdf/mammoth/text parsers, `embedMany` embedder, ingestion and re-index jobs, `file_search` with page citations), web search (SearXNG, Brave, Tavily, Exa; `web_search`; provider-native selection; SearXNG pinned in compose), files/search handlers with upload checks. Verified: end-to-end PDF ingestion + vector search on PGlite + pgvector; chat search; 56/56 turbo tasks; CI passed. Questions: local URL signing secret, which key pays for background embeddings, file-serving headers (logged for 025).
