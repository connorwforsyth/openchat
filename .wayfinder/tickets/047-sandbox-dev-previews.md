---
id: "047"
title: "Sandbox dev-server previews: exec in $HOME and /tmp, and cross-origin previews"
labels: [wayfinder:grilling]
status: open
assignee:
blockedBy: []
---

## Question

**HITL (Connor).** 046 found that the Docker leg of `PLAN.md` §11 M1 step 6 fails as-is (details in
[046](046-m1-predemo-audit.md), follow-ups A and B):

1. **`npm create vite` can't run.** The sandbox's `$HOME` and `/tmp` tmpfs are `noexec`, and `npx` runs
   from `~/.npm/_npx`. Options: (a) `exec` on the two tmpfs mounts in `apps/sandbox-runner/src/spec.ts`,
   since `/work` is executable anyway; (b) `NPM_CONFIG_CACHE=/work/.npm` in the container env (the cache
   lands in the workspace and its snapshots). This loosens hardening, so it's Connor's call.
2. **Vite previews are blank in the panel.** The preview iframe has an opaque origin, which Vite's
   default CORS refuses (D24 puts previews on their own origin). Options: (a) `allow-same-origin` only
   when the preview origin is a different site from the app (not the case on `localhost`); (b) the preview
   proxy answers `Access-Control-Allow-Origin` for `null`; (c) tell the agent to run dev servers with
   CORS on (`vite --cors`).

## Done when

Connor picks an option for each; the loop then builds it in 050.
