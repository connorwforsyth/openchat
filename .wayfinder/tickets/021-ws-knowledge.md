---
id: "021"
title: "WS-knowledge: files, RAG and search"
labels: [wayfinder:build]
status: open
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
