---
id: "163"
title: "Microsites: `@workspace/site-ui` and sites written as TSX pages"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["159"]
---

## Question

Connor (2026-10-16): the microsite should "use very specific libraries that the repo has installed, like a microsite/ui package … pointing it to a library of premade components would probably make it faster to compose". He also said "react can still be fast … as it's just building component props". This replaces his earlier "clean HTML + Tailwind … not the React UI kit" (2026-10-01) for new sites. Existing HTML sites keep rendering. He was "not sure where the stack idea is coming from": the swappable `SiteStack` was ticket 125's addition, and this ticket removes it. The kind is the binding.

## Done when

- **`packages/site-ui` (`@workspace/site-ui`):**
  - Static blocks on `@workspace/ui`'s static parts (button, card, badge, separator), with semantic tokens and logical utilities: `Page`, `Nav`, `Hero`, `FeatureGrid`, `Stats`, `Testimonial`, `Pricing`, `Faq` (native `<details>`), `Cta`, `Footer`, `Section`, `Prose`.
  - Nothing that uses Lingui (it needs an `I18nProvider`) and no overlays or motion utilities (the site's Tailwind input lacks them).
  - All text, aria-labels included, arrives as props: it's site content, not product UI.
  - Icons by a curated name enum, mapped inside the package.
  - A generated Tailwind candidates list (site-ui's source plus the `@workspace/ui` files it imports), with a staleness test.
  - Browser-mode tests.
- **Site kind (`kinds/site/**`):**
  - `tsx` joins `SITE_EXTENSIONS`. The home page is `index.tsx` or `index.html`, never both.
  - TSX pages import only `react`, `react/jsx-runtime` and `@workspace/site-ui`, and only names in `SITE_UI_EXPORTS`. A test keeps that list equal to the package's exports. Unknown names get a sentence such as "Bogus isn't a site-ui component. It has: …".
  - `noNetworkOrStorage` and `fileReferences` cover `.tsx`.
  - `stacks.ts` goes. `stack` stays an optional legacy field that nothing reads.
  - `design/site-ui.md` is the guide, with each block, its props and an example. Every example compiles in a test.
- **Build:**
  - A `compileTsx` port, alongside `CompileTailwind`. Each `x.tsx` becomes an `x.html` shell. Its inline module script hands the compiled module, as a function, to `mountPage` from a new runtime entry, `apps/artifacts/src/site-runtime.ts`.
  - This fits the current site CSP: `'unsafe-inline'` covers it and there's no eval. Escape `</script` and leave raw `.tsx` out of the published output. Preview and publish use the same shell.
  - The server finds the hashed `site-runtime-*.js` at boot. Render errors post on `SITE_PREVIEW_CHANNEL`.
  - **Spike first:** a srcdoc frame under the sandboxed site page loads the runtime from `'self'`.
  - **Never** render model code in-process with `react-dom/server`, since that's RCE. Static pre-rendering through `packages/sandbox` is a later ticket. Until then, published TSX sites need JavaScript.
- **Runtime image and config:**
  - The `Dockerfile` runs the icons `select.ts` step, because `--ignore-scripts` skips the postinstall that writes `selected.ts`.
  - `artifacts.kinds.site.stack` stays accepted because the schema is strict, but it's deprecated and ignored. Update `app.config.example.yaml`.
- **Tests:** kit, runtime and site-server tests, and e2e: a mock-model turn creates `index.tsx` with `Hero` and `FeatureGrid`, previews it and publishes it.

## Owns

`packages/site-ui/**` (new), `packages/artifacts-kit/src/kinds/site/**`, `apps/artifacts/**` (including `Dockerfile` and `package.json`), `packages/config/src/schema.ts` (the site key) and its test, `app.config.example.yaml`, `e2e/tests/sites.spec.ts`, the instructions snapshot.

## Results (2026-10-16)

- **Spike passed first:** a `sandbox="allow-scripts"` srcdoc frame under the served `site.html` (site CSP, no `'unsafe-eval'`) imported a module from the runtime's origin by absolute URL (ACAO `*`). Chromium only.
- **`packages/site-ui`:** `Page`, `Nav`, `Hero`, `FeatureGrid`, `Stats`, `Testimonial` (its credit prop is `byline`, because Biome's ARIA rule rejects `role`), `Pricing`, `Faq` (native `<details>`), `Cta`, `Footer`, `Section` and `Prose`. They're built on button styles, card, badge and separator, with no Lingui and no overlays, and every word comes in as a prop. Icons are picked from 27 curated names, and unknown names are ignored via `hasOwn`. `src/candidates.generated.ts` comes from `scripts/candidates.ts`. Browser-mode tests check rendering, that the exports equal `SITE_UI_EXPORTS`, and that the candidates aren't stale (files read through `commands.readFile`).
- **Kit:** `stacks.ts` is gone. `stack` is now an optional legacy string that nothing reads, and `DEFAULT_SITE_STACK` stays exported because `packages/server/src/api/sites.ts` still writes it. `tsx` is a site extension now. A site needs exactly one of `index.tsx` and `index.html`, and `x.tsx` and `x.html` can't both exist. `tsx.ts` holds `SITE_TSX_MODULES`, `SITE_UI_EXPORTS` and `tsxPageProblems` (bad imports, unknown names, namespace imports, no default export). `tsxReferences` reads JSX attributes, `href:`/`src:` props and imports, and a link to `about.html` resolves to `about.tsx`. `design/site-ui.md` replaces `react-ui.md`, and the instructions now carry both guides, site-ui first. The guide's examples are checked and compiled in the kit tests and rendered in `apps/artifacts`.
- **Build:** there are `CompileTsx` and `SiteTsxPorts` ports. `tsxShell` writes the `.html` shell, escaping `</script` and `<!--` as `\x3C`. Raw `.tsx` files never reach the output, and site-ui's candidates are merged in only when the site has TSX pages.
- **Runtime:** `apps/artifacts/src/site-runtime.ts` (`mountPage` with its require table, mounted with `createRoot`) is built as its own `site-runtime-<hash>.js` by `build:runtime`. The server finds it at boot (and again on each request under `--watch`) and writes it into `site.html` as a `<meta>`. Published shells import it by root path. Render errors post `{type: "error"}` on `SITE_PREVIEW_CHANNEL`, and `site-main` reports them. Nothing is rendered on the server.
- **Config:** `stack` is still accepted (any string), deprecated and ignored. `app.config.example.yaml` is updated, and the Dockerfile now runs `packages/icons/scripts/select.ts`.
- **Snapshots outside Owns,** all derived from this change: `packages/setup` (`plan.test.ts`, which embeds the example yaml) and `packages/ai` (`artifact-golden`, the site JSON error message), along with the instructions snapshot. The instructions grow by about 100 lines, the site-ui guide; ticket 160's on-demand guides could take that out.
- **Verification:** `check`, `check:guards`, `turbo typecheck lint test --filter=...[HEAD]` (composer failed once under load and passed alone), and the e2e `sites.spec.ts`, 7 of 7, including the new TSX preview and publish test.
- **Gaps:** I didn't run `docker build`. The candidates staleness test reads the source list that's already recorded, so a new block file only shows up after `bun run candidates`. Published TSX sites need JavaScript until there's sandbox pre-rendering.
