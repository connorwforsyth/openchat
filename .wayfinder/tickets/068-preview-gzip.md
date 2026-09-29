---
id: "068"
title: "Previews of compressed responses render blank"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-09-30): the preview URL showed nothing in the browser. The preview proxy (`apps/sandbox-runner/src/app.ts`
`createPreviewApp`) forwards with `fetch`, which decompresses gzip/br/deflate bodies, but it passed the upstream
`content-encoding: gzip` header through with the already-decoded body. Browsers then fail to decode it
(`ERR_CONTENT_DECODING_FAILED`, curl exit 61) and show a blank page. Any dev server or `serve` that compresses is affected.

## Done when

- The proxy drops `content-encoding` and `content-length` from responses whose body `fetch` decoded.
- A unit test covers a gzip upstream answering a browser-like request: decoded body, no `content-encoding`.
- Gate passes, and the runner image is rebuilt so the local app gets the fix.

## Owns

`apps/sandbox-runner/src/app.ts`, `apps/sandbox-runner/src/app.test.ts`.
