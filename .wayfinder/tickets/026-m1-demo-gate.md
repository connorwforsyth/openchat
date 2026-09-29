---
id: "026"
title: "M1 demo gate"
labels: [wayfinder:grilling]
status: open
assignee:
blockedBy: ["025", "044", "045", "046", "048", "050", "055", "056", "057", "058", "059", "060", "061", "062"]
---

## Question

**HITL gate.** Connor runs the `PLAN.md` §11 M1 checks in person. Is M1 a daily driver?
What's missing before the waves start?

Closing this ticket graduates the waves from the map's *Not yet specified* into tickets.
The loop never closes it.

## Done when

Connor signs M1 off (or lists fixes as new tickets).

## Demo guide (loop, 2026-09-28)

Automated already (Playwright e2e 24/24, local gate, 045/046/050 checks), so skip or skim:
- §11 M1 steps 1–5, 7, 8, 10 and the just-bash half of 6 (e2e); step 9 (i18n: `lingui extract` clean).
- Config and brand (invalid config error, `brand.name`, brand guard), contract (`/api/openapi.json` + Redocly), "CI lists unmapped icons".
- Step 6 isolation: `web` has no Docker socket; the runner reports runc with the warning on macOS.

Worth seeing in person:
- **Step 6, Docker leg:** `docker compose --profile sandbox up -d --build`, set `sandbox.default: docker` in `app.config.yaml`, ask the agent to `npm create vite` and start a dev server, and open the Preview tab. Use Chrome: the Claude app's built-in browser blocks `*.sandbox.localhost`.
- **Icons:** set `icons: { set: material }` (or `ICON_SET=material`) and rebuild.
- A real model: add a provider key in `app.config.yaml`/settings, or run Ollama.
- Anything that feels off as a daily driver.
