---
id: "125"
title: "Sites: a constrained site kind with swappable stacks, and publishing"
labels: [wayfinder:build]
status: open
assignee: 
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
