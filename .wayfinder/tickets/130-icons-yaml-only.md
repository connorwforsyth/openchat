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

## Results (2026-10-02, loop)

- **Precedence: (a), the yaml wins.** `packages/icons/scripts/config.ts`: an `icons` block (even an empty `icons:`) decides outright, and `ICON_*` count only when there's no block (no config file, or no key). That keeps them as the explicit build-arg override for an image built from a context without a config. Removing them entirely, option (b), would have broken that path. Blank values (an unset build arg) still don't count.
- **Warning:** `icons:select` prints one line naming the variables (never their values) whenever any is set. It says either "ICON_SET is set but ignored: the icons block in … decides" or "ICON_SET sets the icons because … has no icons block". This covers Connor's case: Phosphor in the yaml with `ICON_SET=material` in `.env` now builds Phosphor and warns.
- **Setup:** it no longer writes `ICON_*` to `.env`. The `icons` block already held the choice, and it now also carries Material's `weight`/`fill`. Defaults follow the new precedence. When `.env` has `ICON_*` lines, setup asks (`iconEnv`, names only) whether to move them into the yaml and delete them from `.env`. The deletion goes through `removeFromEnv` in `env-file.ts`, next to `updateEnv`. A setup header left with nothing under it is dropped too. Declining leaves `.env` byte-for-byte unchanged.
- **Docker:** `apps/web/Dockerfile` builds with `CONFIG_PATH=/repo/app.config.yaml` when `apps/web/app.config.yaml` is absent and the root one (written by setup, mounted by compose) is present. Icons and fonts in an image now come from the yaml that setup writes. `docker-compose.yml` no longer passes `ICON_*` build args. The Dockerfile keeps the `ARG`s as the no-config override.
- **Docs:** `docs/self-hosting.md` "Icon set" and "Fonts" are rewritten. Also updated: `packages/icons/README.md`, the `app.config.example.yaml` comment and `packages/icons/.gitignore`.
- **Verified:** icons tests 102 (precedence, empty block, blank args, warnings). Setup tests 78 (`removeFromEnv`, both migration cases, the wizard prompt never showing values, decline, no prompt without `ICON_*`), with snapshots updated. `bun run check` and `check:guards` exit 0. Gate: 93/93 tasks and `evals --strict` ok. E2E on 3307: 95 passed. A Docker image built with a root config of `icons: { set: phosphor }`, `fonts: { sans: inter }` and `--build-arg ICON_SET=material` gave Phosphor and Inter, plus the warning line.
