---
id: "068"
title: "Previews of compressed responses render blank"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results (2026-09-30, loop)

`createPreviewApp` deletes `content-encoding` and `content-length` when the upstream response had an encoding. There's a unit test (fake decoded upstream), and runner tests pass 19/19. The runner image was rebuilt from host-built dist (Docker Desktop's registry proxy is hanging). Found alongside it: the runner forgets exposed ports on restart, so recorded previews 404; handed to 067 (re-expose on attach).

## Resolution (2026-09-30, loop)

Merged in [PR #56](https://github.com/connorwforsyth/openchat/pull/56).
