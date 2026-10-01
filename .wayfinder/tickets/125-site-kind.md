---
id: "125"
title: "Sites: a constrained site kind with swappable stacks, and publishing"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["123"]
---

## Question

The artifact framework (`docs/proposals/2026-10-01-artifact-framework.md`, PR #76, with Connor's answers in `.wayfinder/QUESTIONS-FOR-CONNOR.md`, "Answered 2026-10-01"). Connor: "artefacts framework keen as well" (2026-10-02). Additive contract routes for the Artifacts page are approved, each in its own PR.

Connor: sites are clean HTML + Tailwind with the instance theme, guided by a design.md (react-ui pre-rendered as an alternative stack, swappable later); public resources (fonts, CDN libraries) from an allowlist; otherwise locked down; a kind works like a skill under the hood.

## Done when

- **Kind and stacks:** the `site` kind with stacks `html-tailwind` (default) and `react-ui` (pre-rendered on publish). Each stack is a definition: libraries, theme tokens, `design.md`, checks, build.
- **Network:** a CSP allowlist of public origins (fonts and CDNs), editable by admins in config.
- **Publish:** a share link serving the built site on the artifacts origin. Password protection is a later ticket.
- **Save as artifact:** a workspace folder becomes a Site if it passes the checks.
- Tests and e2e. Gate passes.

## Owns

`packages/artifacts-kit/src/kinds/site/**`, `apps/artifacts/**`, config (`artifacts.kinds.site`), e2e.

## Results (2026-10-02, loop)

Built on `t/125-sites`, not pushed. Commits: `8aaf7a6` (kind instructions in turns), `0641222` (**contract, on its own, not yet approved**), `af1b3cb` (the site kind and config), `4fe6cd2` (db and server), `08fd2ae` (runtime), `5df418b` (UI), then e2e, two snapshot follow-ups and this note.

- **Kind instructions in turns (the 123 gap):** `composeInstructions` has a `kinds` layer after the fragments and before the mentions. A turn whose tools include `create_artifact`/`update_artifact` gets the instance kinds' instructions. Empty instructions add nothing; that commit left every snapshot unchanged. Adding the Site kind then changed seven turn types' system prompt in `server/src/runs/instructions.test.ts` (same section each).
- **Content shape:** a site version is JSON text, `{"stack": "html-tailwind", "files": {"index.html": "…", "about.html": "…", "css/site.css": "…", "logo.svg": "…"}}`. `index.html` is required; up to 40 files and 400 000 characters; text only (.html .css .js .mjs .json .svg .txt); relative paths, no hidden files or `..`. `stack` defaults to html-tailwind. Documented in `kinds/site/content.ts`.
- **Stacks** (`kinds/site/stacks.ts`): each is libraries, theme colours, a `design.md` (generated into `design/generated.ts`, with a staleness test), checks and a build. `html-tailwind` is complete. `react-ui` is defined but `available: false`: its checks refuse it and config can't select it. Pre-rendering needs the UI kit bundled for the runtime and a server render, which is its own ticket.
- **Checks:** the stack is offered; a home page and the size limits; pages are HTML; local links and resources exist and don't start with `/`; external resources (script, link, img/srcset, media, iframe, CSS url()/@import, JS imports) come only from allowed https origins; no fetch/XHR/WebSocket/EventSource/sendBeacon/localStorage/sessionStorage/indexedDB/cookies. Links to other sites are fine.
- **Build:** Tailwind v4's own `compile` over the instance theme. The theme's `@theme inline`, `:root` and `.dark` blocks are read from `packages/ui/src/styles/globals.css` (no copy); dark follows `prefers-color-scheme`. The compiler is a port, so the kit ships none. A preview build inlines local CSS, JS and SVG and passes page links to the runtime. No async checks were needed: an html-tailwind build can't fail on content that passed the checks, since Tailwind ignores unknown classes. `react-ui` would need one.
- **Config:** `artifacts.kinds.site { enabled, stack, allowedOrigins }`. The defaults are Google Fonts (both origins), cdnjs and jsDelivr. Origins must be https with no path, with `https://*.host` allowed. The defaults and the pattern live in `@workspace/config/sites`, because `icons` → `config` meant config couldn't depend on the kit. Public config carries `artifacts.siteOrigins`.
- **CSP** (`kinds/site/csp.ts`): `default-src 'none'`; script/style `'self' 'unsafe-inline'` + origins; font/img/media `'self' data:` (+`blob:`) + origins; `connect-src`, `object-src`, `worker-src`, `form-action` and `base-uri` are `'none'`; `frame-src` is `'self'` for a preview and `'none'` for a published site; `frame-ancestors` is the app's origins; `sandbox allow-scripts` (a published site also gets popups). There's no `unsafe-eval`. Entries that aren't origins are dropped.
- **Runtime:** `site.html` is served with the preview CSP. The runtime fetches the origins from `ARTIFACTS_API_ORIGIN/api/config`, caches them for 30 s, and uses none if that fails. `/s/<token>/<path>` serves a published site from `GET /api/published/{token}`, built once per published version.
- **Publish:** owner only, sites only. It rechecks the latest version against the current rules and needs `features.publicLinks` and `ARTIFACTS_ORIGIN`. Publishing again keeps the token; unpublishing deletes the link. UI: Publish in the artifact menu.
- **Save as artifact:** `Save as site…` in the Workspace menu. The folder's text files (hidden ones skipped) are checked as a Site; problems come back as VALIDATION issues. The caller owns the result.
- **DB:** `artifact_publication`, plus `site` in the kind check (migration `20261001193633_sites`).

**Verified:** check and guards pass on every commit. `bun turbo typecheck lint test --continue`: 88 of 89 tasks, with the one failure the sandbox golden, since updated. New tests: kit 23, config 5, server 6, db 4, runtime 9, chat-ui 1. **Not verified: `gate.sh` and `e2e.sh 3292`.** `next build` of apps/web is SIGKILLed after about 100 s at a 39 GB peak footprint, with system swap around 40 GB. origin/main fails the same way in this worktree, so it's the machine, not this branch. The runtime build, its server (checked by hand with curl: published CSP, 308 to the folder, 404s) and its unit tests all pass. `e2e/tests/sites.spec.ts` is written but hasn't run.

**Open questions:** the contract commit needs Connor's approval. Every turn with the artifact tools now carries the Sites instructions (about 40 lines), which a skill-style "load on demand" (127) could shrink. The React save-time import check is still not done. A published site can load other published sites' files through `'self'` on the artifacts origin.
