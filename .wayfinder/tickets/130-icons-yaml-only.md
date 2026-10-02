---
id: "130"
title: "Icon set from app.config.yaml only; setup stops writing ICON_* into .env"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02): "I guess i wouldnt want to have icon stuff in the env? that's a bit too much." The setup CLI (`packages/setup/src/plan.ts`) writes `ICON_SET`/`ICON_STYLE`/`ICON_WEIGHT`/`ICON_FILL` into `.env`, and those override the yaml's `icons:` block. His local `.env` silently forced Material even after he chose Phosphor in the yaml. Fonts (129) are yaml-only.

## Done when

- Setup writes the icon choice into `app.config.yaml`'s `icons:` block, not `.env`.
- Docker builds read `apps/web/app.config.yaml` from the build context, the way fonts do. Decide whether to keep `ICON_*` build args as an advanced override or remove them; at minimum, `.env` no longer carries them by default.
- `icons:select` logs a clear warning when an env var overrides the yaml.
- Update `docs/self-hosting.md`, `docker-compose.yml` and the setup tests.
