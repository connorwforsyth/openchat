---
id: "163"
title: "Microsites: `@workspace/site-ui` and sites written as TSX pages"
labels: [wayfinder:build]
status: open
assignee:
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
