# T3 Code vs openchat: engineering practice, tooling and agent-driven development

Paths starting `t3:` are in `/tmp/study/t3code`. Paths starting `oc:` are in `/Users/connorforsyth/GitHub/openchat`. I edited nothing in either repo.

## Ranked recommendations

| # | Practice | Adopt? | Value |
|---|---|---|---|
| 1 | Ports and state derived from the worktree path | Yes | Highest: fixes the loop's e2e and port failures |
| 2 | Unused files, dependencies and exports (knip) gated in CI | Yes | High |
| 3 | AGENTS.md: "three ways to hurt yourself" and "hit every surface" | Yes, adapted | High |
| 4 | Real lint rules with ratchets, beside the regex guards | Partly | Medium-high |
| 5 | Concurrency caps and focused-check rules for agents | Yes | Medium-high: the OOM kills |
| 6 | Documentation rules | Yes | Medium |
| 7 | A worktree setup script | Yes | Medium |
| 8 | CI split into parallel jobs behind one required `Check` | Later | Medium (Actions minutes are the limit now) |
| 9 | License notice generation | Later | Low-medium (needed before distribution) |
| 10 | The Vite+ toolchain, effect-tsgo, `patches/`, Blacksmith runners, contributor triage | No | — |

---

## 1. Dev server and port isolation for parallel agents (highest value)

**What T3 does**
- **Ports.** `t3:scripts/dev-runner.ts` (921 lines) works out a port offset in this order of precedence (`resolveOffset`, around lines 218–266):
  1. `T3CODE_PORT_OFFSET`;
  2. a hash of `T3CODE_DEV_INSTANCE`;
  3. inside a linked worktree, `(Hash.string(worktreePath) % 3000) + 1`;
  4. otherwise 0.

  The bases are 13773 (server) and 5733 (web). Each port is probed on `127.0.0.1` and `::1` only; probing wildcard hosts too made ports drift. Ports that browsers block under the Fetch spec are skipped. If nothing is free it returns a typed `DevRunnerPortExhaustedError`. The real ports are printed on a `[dev-runner]` line, and AGENTS.md tells agents to read them from there rather than assume.
- **State.** `t3:packages/shared/src/devHome.ts` finds a linked worktree by reading the `gitdir:` pointer in `.git`, which correctly excludes submodules and handles bare repos. That worktree's state goes in its own gitignored `.t3/`, which deliberately outranks an ambient `T3CODE_HOME`. The main checkout uses `~/.t3/dev`. The live `~/.t3/userdata` is never written to.
- **Test data.** AGENTS.md "Test data" says to seed a worktree by snapshotting real data with SQLite `VACUUM INTO`: copy in, never symlink, data flows one way.
- **Killing processes.** AGENTS.md rule 1: never `pkill -f`. Kill only a PID you captured at spawn, or the owner of your port after confirming its cwd is your worktree.

**What openchat does**
- `oc:playwright.config.ts` and `oc:e2e/support/serve.ts:46` default `E2E_PORT` to **3100** in every worktree. The loop log confirms the cost (`oc:.wayfinder/LOOP-LOG.md:120`): "the loop's earlier failure came from a shared default e2e port".
- The mocks in `serve.ts` already take OS-assigned free ports (`freePort`, line 130). Only the Next server is fixed.
- `apps/web` runs plain `next dev`, so every worktree uses 3000.
- Data is isolated by accident rather than by design: PGlite's data dir `./.data/pglite` is relative, so each worktree gets its own. That breaks as soon as a worktree gets a `.env` with `DATABASE_URL`, because then every worktree shares `localhost:5432/app`.

**Adopt**
- **E2E port.** Add a small pure function, for example `devPort(base, worktreePath)`, in `scripts/` and use it in `playwright.config.ts` (`E2E_PORT ?? 3100 + hash(repoRoot) % 2000`). Use it for `next dev` as well (a `dev` wrapper passing `--port`) and for the evals and desktop ports.
- **Print the ports.** Print the resolved ports so agents read them instead of assuming.
- **Loop instructions.** Add the "never kill by pattern" rule to `oc:.wayfinder/LOOP.md` and AGENTS.md. The loop runs about three sub-agents at once on one machine, which is exactly the situation T3 wrote that rule for.
- **Database isolation.** If worktrees ever get an env file, derive a per-worktree database name, for example `app_t_<id>`.

## 2. Dead code and unused exports: knip (openchat has nothing for this)

**What T3 does**
- `t3:knip.jsonc` turns off the `types` and `nsTypes` rules ("Exported types are part of our contracts even before they have consumers").
- It lists non-import entry points per workspace: Electron bundles, Expo plugins, scripts run from `t3.json`. Every entry has a comment saying why.
- `includeEntryExports: true` is set for the private `packages/*`.
- `ignoreIssues` covers shadcn `components/ui/*.tsx` (keeping whole component sets) and generated protocol code.
- `t3:scripts/knip-schemas.ts` is a preprocessor. It uses the TypeScript type checker to drop "unused export" findings for exports whose type carries Effect's `~effect/Schema/Schema` marker, so schemas may be exported without consumers. It has its own test (`knip-schemas.test.ts`).
- `package.json` defines `knip:check`: files and dependencies across the whole repo, then `--exports` only for the workspaces that are already clean. That is a ratchet. CI runs it in the Lint job (`t3:.github/workflows/ci.yml`, "Check unused code").

**What openchat does**
- Biome via Ultracite catches unused imports and variables within a file, but nothing finds unused exports, unused files or unused dependencies across files.
- With more than 130 agent-written tickets across about 20 packages, orphans pile up. Two examples: dead exports in `@workspace/shared`, and `bun.lock` dependency churn that no one removes.

**Adopt**
- Add knip at the root with a `knip.jsonc` modelled on T3's:
  - `types: off`;
  - `includeEntryExports` for `packages/*`;
  - `ignoreIssues` for `packages/ui/src/components/**` (shadcn sets);
  - entries for `scripts/ci/cli.ts`, `.wayfinder/frontier.ts`, `e2e/support/*.ts`, the `packages/setup` CLI, `fonts:select` and `icons:select`.
- **Zod schemas.** You probably don't need a preprocessor. Export schemas only from `@workspace/contract`, and exclude that package from the `--exports` pass, since it is a frozen public interface.
- **Rollout.** Gate files and dependencies first. Add the `--exports` check one package at a time, as T3 does.

## 3. How AGENTS.md is written

**T3 (`t3:AGENTS.md`, about 17 KB)** is in Theo's voice and mostly about behaviour, not rules. It has:
- **Values.** "Things we can never compromise on" (open, performance, remote-ready, multi-surface), and a note on taste: "fight for the smallest model", yagni.
- **A glossary.** It pins down who "you", "we" and "user" are, plus "agent", "provider", "environment", "thread", "turn". The full glossary with file links is in `docs/internals/glossary.md`.
- **"The three ways to hurt yourself".** Killing by pattern, writing to the live install, baking origins into the bundle. Concrete failures, each with its reason.
- **"Hit every surface".** A checklist the agent must walk and report on before calling frontend work done: entry points (chat, Settings, palette, keybinding), clients, providers, agent/MCP reachability ("must be a service method, not handler code"), contracts, reverse states ("Snooze needs unsnooze… A one-way door is a bug"), connection modes, docs.
- **Verification rules.** "Do not run repo-wide checks. CI owns the full suite." Wait on receipts, never sleeps ("A test that needs a timeout to pass is wrong"). No tests that mirror the implementation.
- **Sub-agent rules.** Sub-agents don't launch dev servers. Ask before using a browser or computer use.
- **PR rules.** One concern per PR ("If the description says 'also', split it"). Before/after images. A procedure for babysitting bot findings.
- **A conflict rule.** "If a rule here fights the task, say so loudly and get a human sign-off."

**openchat (`oc:AGENTS.md`)** is a crisp list of engineering, UI and motion rules that link to PLAN decisions, plus a table of CI guards. It is strong on *what code must look like* and has no equivalent of the "hurt yourself" section, the surface checklist, or a glossary.

There is also a drift bug. The guard table lists four guards, but `oc:scripts/ci/cli.ts:39` defines five; `motion` is missing from the table.

**Adopt**
- **A "hurt yourself" section** for openchat. Candidates:
  - killing by pattern;
  - assuming port 3000 or 3100;
  - running the full `bun turbo … build` in parallel worktrees (the OOM);
  - deleting untracked files you didn't create (already in LOOP.md, from the doma incident);
  - pointing a dev server at the real compose database.
- **A "hit every surface" checklist** fitted to openchat's surfaces:
  - web, desktop (`apps/desktop`) and mobile/Expo (decision record 0006);
  - the ⌘K palette, keybindings (`packages/shortcuts`) and Settings;
  - admin vs member vs org/team grants (`effectiveGrants`);
  - agents and MCP reachability;
  - the empty-`.env` / Ollama fallback;
  - i18n strings;
  - the oRPC contract;
  - reverse states.

  Make loop sub-agents state which entries applied in their report. Several loop bugs were exactly "worked on the tested path": 116 (⌘K search), 134 (dropped second send).
- **A short glossary** (thread/chat, run, harness, artifact, sandbox, org/team, grant).
- **The motion row** in the guard table, plus a guard test that compares the table against `GuardName`.

**Don't copy:** the founder-voice marketing ("400,000 users"), or the "rules are good defaults, not hard rules" stance. openchat's rules are CI-enforced, so it should stay strict.

## 4. Custom lint rules vs openchat's `scripts/ci` guards

**What T3 does**
- `t3:oxlint-plugin-t3code/` is a JS plugin for oxlint (`defineRule`, `createOnce`). Each rule has a co-located `*.test.ts`:
  - `namespace-node-imports`: `import * as NodeFS from "node:fs"`, with canonical aliases;
  - `no-global-process-runtime`: no `process.platform` or `process.arch`; inject `HostProcessPlatform` (the ports idea, enforced);
  - `no-hermes-unsupported-apis`: no `toSorted`, `toReversed`, `toSpliced` or `Intl.Segmenter` in code shared with mobile;
  - `no-inline-schema-compile`: no `Schema.decode*` inside function bodies, for hot-path performance;
  - `no-manual-effect-runtime-in-tests`, with a per-file `maxOccurrences` debt ratchet in `t3:vite.config.ts` ("Lower a ceiling when you migrate a file, and delete its entry at zero");
  - `no-native-title-tooltip`: no `title=` on intrinsic elements; use the Tooltip component;
  - `no-mobile-uniwind-theme-escape-hatches`: no `dark:`/`light:` on mobile.
- `@shadcn/lint` rules are also on in `t3:vite.config.ts`:
  - `no-raw-colors`, `no-unknown-classes`, `no-arbitrary-values` (with a commented allow-list);
  - `no-restyle`: components in `components/ui` own their look; app code picks a variant;
  - `require-static-classes`.
- `eslint/no-restricted-imports` blocks borrowing `buttonVariants` and limits pull-request glyphs to one module.
- `reportUnusedDisableDirectives: "error"`.

**What openchat does**
- `oc:scripts/ci/{tokens,icon-imports,brand,lingui,motion}.ts` are regex and line scanners. They are pure functions, have fixtures, are tested, and report `path:line:col`.
- They include a `ci-guard-ignore` escape hatch and a shrink-only `icon-imports.allow`, which is the same ratchet idea as T3's `maxOccurrences`.

**Recommendations**
- **Keep** `brand` and `lingui`. They are not syntax-shaped: one scans every file type, the other diffs catalogs.
- **icon-imports.** Replace it with Biome's `noRestrictedImports` (paths or patterns plus an override for `packages/icons`). That's native, editor-visible and fixable, and the allow-list becomes `overrides` entries.
- **tokens.** Consider `@shadcn/lint`'s `no-raw-colors` and `no-unknown-classes` for TSX. `no-unknown-classes` catches typoed Tailwind classes, which regex can't. Run it through a small oxlint pass, or keep the regex for CSS. Keep the regex tokens guard as the backstop.
- **New rules worth porting** (as Biome GritQL plugins, or oxlint JS plugins if you add oxlint beside Ultracite):
  - `no-native-title-tooltip`. AGENTS.md wants accessible tooltips, and `title` is also a Lingui risk.
  - **`no-restyle` from `@shadcn/lint`.** It gives `packages/ui` the variant discipline that D5 implies.
  - **A `no-hermes-unsupported-apis` equivalent.** openchat has an Expo app, so code in `@workspace/shared` and `@workspace/chat-ui` that ships to mobile has the same `toSorted` crash risk.
  - **A ratchet.** Treat `maxOccurrences` per file as the general pattern for legacy debt instead of `biome-ignore` comments.
- **Check unused suppressions** (`reportUnusedDisableDirectives`), so `biome-ignore` and `ci-guard-ignore` markers that no longer suppress anything fail CI. Unused `ci-guard-ignore` markers could be added to the guards the same way.

## 5. Load, OOM and "don't run the world"

**What T3 does**
- The root `typecheck` is `vp run -r --concurrency-limit 2`.
- AGENTS.md "Verifying" forbids repo-wide checks for agents. The development runbook (`t3:docs/operations/development.md` "Checks") prescribes `vp test run <files>`, `vp lint <files>` and `--filter <pkg> typecheck`.
- Server tests run `fileParallelism: false` with a duration-weighted shard sequencer (`t3:apps/server/src/testUtils/weightedShardSequencer.ts`, `shardWeights.json`).
- Tests use receipts, not sleeps.

**What openchat does**
- The loop's merge gate is the full `bun turbo typecheck lint test build`, run by up to three agents at once on one laptop. The log records "next build OOM-killed under load" (`LOOP-LOG.md:146`), unit tests failing at "load avg 60", and repeated e2e reruns.
- `oc:scripts/ci/browser-lock.ts` already serializes Vitest browser mode across worktrees with an atomic `mkdir` lock in the OS temp directory. That is good, and T3 has nothing like it.

**Adopt**
- **Lock builds too.** Generalize `browser-lock.ts` to a named lock (`--name next-build`) and wrap `apps/web` `build` and the e2e run, so only one `next build` runs per machine.
- **Lower turbo concurrency for the loop.** Add `--concurrency=2` (or a percentage) to the loop's gate command.
- **Focused checks for sub-agents.** They run `--filter=<owned packages>...` while working. Only the loop's verify step (step 5) runs the full gate, serialized.

## 6. Documentation rules

**What T3 does.** AGENTS.md "Documentation" splits docs into three places:
- `docs/internals/`: decisions, constraints that span components, and traps. "Ask what a maintainer would get wrong without it." No field lists or PR summaries. When a decision changes, rewrite the text rather than appending to it.
- `docs/user/`: one task-oriented section per major feature.
- `docs/operations/`: runbooks.

`t3:docs/README.md` indexes all three. Separately, "Plans and work artifacts" says: don't commit plans or scratch files, and "a merged PR is the implementation record".

**What openchat does.** It has `oc:docs/decisions/` (ADRs), `docs/proposals/`, `PLAN.md` and `.wayfinder/` (ticket resolutions appended to tickets, the map's "Built" list, LOOP-LOG). Its tracker is intentionally in the repo, so T3's "no plans in repo" rule is the wrong fit.

**Adopt** T3's internals and user-docs rules, especially:
- rewrite, don't append, when a decision changes (PLAN.md decisions D1–D28 risk accumulating amendments);
- don't document what the code says.

openchat has no `docs/user/` yet; it will need one for self-hosters.

## 7. Worktree setup

**What T3 does.** `t3:t3.json` runs `scripts/setup-worktree.ts` when a worktree is created. The script:
- installs dependencies;
- **symlinks** the main checkout's gitignored `.env` files into the worktree, skipping this when the worktree is the main checkout;
- warms the web dependency cache.

AGENTS.md: "if module resolution looks broken, it probably did not run."

**What openchat does.** In `oc:.wayfinder/LOOP.md` step 4, worktrees are created by hand with `git worktree add`. Sub-agents then run `bun install` themselves.

**Adopt** a `scripts/setup-worktree.ts` that:
- runs `bun install`;
- runs `i18n:compile` and `icons:select`, which turbo otherwise rebuilds on first run;
- links (or deliberately doesn't link) `.env`, with a decision about database isolation per §1.

LOOP.md step 4 calls it. Since this session runs inside T3 Code, a `t3.json` would also make T3's own worktree action work.

## 8. CI structure and speed

**What T3 does** (`t3:.github/workflows/ci.yml`)
- Separate parallel jobs: lint (knip plus `vp check`), typecheck, build, test, test_web, a 6-shard server matrix, rust, release smoke.
- A gate job for the macOS native lint that fails open.
- A single `Check` job with `if: always()` that requires every job's result to be success. Branch protection names only `Check`, so jobs can be split without ruleset edits, and cancelled runs fail.
- Every job has `timeout-minutes: 10`.
- A sparse checkout excludes `.repos/`.
- apt installs are kicked off in the background while other setup runs.
- A step rejects committed `.github/pr-assets`.
- Separate workflows: `pr-size.yml` (size labels), `pr-vouch.yml`, `windows-tests.yml` (manual).

**What openchat does** (`oc:.github/workflows/ci.yml`)
- One `ci` job runs everything in series (20 minutes).
- A `db` job runs on Postgres 17.
- e2e and sandbox jobs run only on pushes to main, because Actions minutes ran out. The merge gate is local (LOOP.md step 1).

**Adopt later.** The single required `Check` aggregator pattern, and splitting `ci` into parallel jobs, are worth it once minutes allow; parallel jobs cost more total minutes. Two cheap wins now:
- `cancel-in-progress` is already set;
- add the knip step.

The size-label idea could feed the loop's "split if more than a day" rule.

## 9. License notices

**What T3 does.**
- `t3:scripts/sync-third-party-license-notices.ts` with `scripts/lib/third-party-licenses.ts` walks the production dependency closure.
- The build fails when a package has no SPDX identifier or no license text.
- It emits a static `third-party-licenses.json` that the Settings page renders.
- `third-party-licenses.config.json` holds custom notices for fonts, icons and media.
- Documented in `t3:docs/internals/open-source-licenses.md`.

**What openchat does.** It has a root `NOTICE` and nothing generated.

**Recommendation.** Worth adopting before shipping Docker images or desktop builds. With `@lobehub/icons-static-svg`, fonts and Electron in the tree, a build gate is cheap insurance.

## What not to copy

- **Vite+ (`vp`), oxfmt, pnpm.** It is VoidZero's unified toolchain, and T3 even patches `@effect/vitest` to import `vite-plus/test` (`t3:patches/@effect__vitest@4.0.0-rc.115.patch`). openchat is committed to bun, turbo and Ultracite/Biome, and switching would churn everything for no gain.
- **effect-tsgo (`prepare: effect-tsgo patch`).** It patches TypeScript 7 for Effect language-service diagnostics, which is specific to Effect. openchat doesn't use Effect.
- **Blacksmith runners.** They're paid, which breaks openchat's OSS-only rule.
- **Contributor triage, vouch lists, Macroscope and CodeRabbit gates, CONTRIBUTING's approval policy.** These are built for a high-volume public repo; openchat is single-owner and private.
- **`.repos/` vendored reference checkouts (effect-smol, alchemy).** A nice idea, but openchat gets the same benefit from `node_modules/next/dist/docs`.
- **"Rules are good defaults" framing.** openchat's rules are enforced in CI, so keep them strict.
