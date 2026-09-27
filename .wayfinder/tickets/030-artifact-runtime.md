---
id: "030"
title: "Artifact runtime: React and Mermaid previews on a separate origin"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["015"]
---

## Question

015 previews HTML/SVG artifacts in an `srcdoc` sandboxed iframe and shows React/Mermaid as source
only. `PLAN.md` M1 includes an artifacts panel with live previews, and D24 requires artifacts and
previews to be served from a **separate origin** with no access to app cookies. Build the artifact
runtime: a small static preview app served from a separate origin (its own port/subdomain in
compose, e.g. `artifacts.localhost`), receiving artifact code over `postMessage`, bundling React
artifacts in the browser (e.g. esbuild-wasm or Sucrase + an import map of allowed packages),
rendering Mermaid, reporting errors back, with a strict CSP. Stamp `data-src="file:line"` in the
bundle step so the Annotate wave can use it (D16).

## Owns

`apps/artifacts` (new), `packages/chat-ui/src/artifacts/` (preview wiring), `docker-compose.yml`.

## Done when

HTML, SVG, React (with a hook and an allowed import) and Mermaid artifacts render on the separate
origin in `/dev/chat`; the frame can't read the app's cookies or storage; errors show in the panel.
