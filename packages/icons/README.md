# @workspace/icons

One swappable icon registry for web and React Native (PLAN.md D19). Every
component imports icons from here, never from an icon library.

```tsx
import { ChevronRightIcon, SendIcon, BranchIcon } from "@workspace/icons";
import { SendIcon } from "@workspace/icons/native";
```

## Vocabulary

`src/names.ts` lists every name. Names are lucide's (`ChevronRightIcon`), since
shadcn, AI Elements and React Native Reusables all import lucide, plus a few
semantic aliases (`BranchIcon`, `ContextIcon`, `AttachIcon`, `StopIcon`, …)
that name what an icon means so a set can draw it differently. Props follow
lucide's (`size`, `strokeWidth`, `className`, SVG attributes).

To add an icon: add the name to `src/names.ts`, map it in `src/sets/lucide.ts`
and `src/sets/lucide.native.ts` (lucide is the fallback, so it must be
complete; `sets.test.ts` checks), and optionally in other sets.

## Sets and build-time selection

| Set | Web | Native |
|---|---|---|
| lucide | `sets/lucide.ts` | `sets/lucide.native.ts` |
| phosphor | `sets/phosphor.ts` (all but 9) | not yet |
| material | `sets/material.ts` (all but `GitBranchIcon`) | not yet |
| tabler, hugeicons | not yet | not yet |

The set is chosen at build time from the `icons` block of `app.config.yaml`,
read where the web server reads it: `CONFIG_PATH`, else `app.config.yaml`,
both relative to `apps/web`. That block decides. `ICON_SET`, `ICON_STYLE`,
`ICON_WEIGHT` and `ICON_FILL` count only when there's no block (Docker build
args for an image built without a config; see `docs/self-hosting.md`), and
`icons:select` warns, naming the variable, whenever one is set.

The `icons:select` script writes `src/selected.ts` and `src/selected.native.ts`
(gitignored), which are the package entries: each name is re-exported from
exactly one set file, so the other sets never reach the bundle. Names the
chosen set lacks come from lucide, and only those. Turbo runs `icons:select`
before `build`, `dev` and `typecheck`, keyed on those variables, `CONFIG_PATH`
and the config at `apps/web/app.config.yaml` (or the repo root); a config
elsewhere isn't hashed, so run with `--force` after editing its `icons`
block. `postinstall` runs it once so editors resolve the package.

```sh
bun turbo build --filter web   # after editing the icons block
bun run icons:gaps     # per set and platform, which names fall back to lucide
```

To add a set, create `src/sets/<id>.ts` (and/or `<id>.native.ts`) exporting
`export const FooIcon = …` for the names it covers; the scripts discover it by
file name.

### Material Symbols

`sets/material.ts` maps names to symbols as `fromMaterial(glyph.<symbol>)`.
The path data comes from `src/sets/material.glyphs.ts`, which `icons:select`
generates (gitignored) in the configured style (`outlined`, `rounded`,
`sharp`; default `outlined`), weight (100–700; default 400) and fill: SVG
paths rather than the variable font, so each icon costs a few hundred bytes
and unused ones drop out.

It picks them from `vendor/material-symbols/svg-<weight>.json`, a committed
subset of the `@material-symbols/svg-100…700` packages (Apache-2.0; `LICENSE`
and `NOTICE` sit beside it): just the mapped symbols, in all 42 style, weight
and fill variants, about 1.7 MB. The packages themselves are ~165k files, so
they're not a dependency; `icons:vendor` installs them into a temporary
directory when it runs.

To map another name, add a line with the symbol's name from
[the catalogue](https://fonts.google.com/icons), then regenerate the subset
and commit it:

```sh
bun run icons:vendor          # same release as the committed data
bun run icons:vendor 0.48.0   # or move to another release
```

It fails without writing anything if a symbol is missing or isn't a single
path in any variant. `sets.test.ts` checks the committed data covers every
mapped symbol in every variant, so a name mapped without regenerating fails
the tests (and `icons:select`).

## Brand marks

`@workspace/icons/brands` draws vendor logos for the model picker (099):
`<BrandMark brand="anthropic" className="size-4" />`, plus `brandName(id)`
(`openai` is "OpenAI") and `hasBrandMark(id)`. They sit outside the
vocabulary above because a brand's mark is the same whichever set is chosen.
An id with no mark renders nothing, so the caller draws its own fallback (the
picker's letter mark).

- `src/brands/brands.ts` is the one list: vendor id (as refs spell it, so
  `meta-llama` and `x-ai` too) to display name and mark.
- The marks come from [`@lobehub/icons-static-svg`](https://github.com/lobehub/lobe-icons)
  (MIT, `LICENSE` and `NOTICE` in `src/brands/`), a devDependency pinned in the
  root catalog. `bun run icons:generate` copies the monochrome
  (`currentColor`) path data of just the listed marks into
  `src/brands/marks.generated.ts`, which is checked in: nothing reads the
  package or the network at runtime, and Next, Vitest and bun import it
  without a loader. A mark with a fixed colour, a gradient or a stroke fails
  the generator rather than being half-copied.
- `src/brands/brands.test.ts` fails when the generated file disagrees with the
  installed package or the list.

To add a vendor, add a line to `brands.ts` (the mark is a file name in the
package's `icons/` folder, without `-color` or `-text`) and run
`bun run icons:generate`. To update the marks: bump
`@lobehub/icons-static-svg` in the root `package.json` catalog, `bun install`,
`bun run icons:generate`, and review the diff of `marks.generated.ts` (a
redrawn mark shows as changed path data; a removed one fails the generator).

## Codemod

`bun run icons:codemod [globs…]` rewrites `from "lucide-react"` to
`from "@workspace/icons"` and `lucide-react-native` to
`@workspace/icons/native` (named, type, namespace, re-export, dynamic and
`require` forms). Unsuffixed names become `ChevronRightIcon as ChevronRight`,
and `LucideIcon`/`LucideProps` map to `Icon`/`IconProps`. It exits non-zero
when a file imports a name the registry lacks. **Run it after every
`shadcn add` or AI Elements install**, then `bun run fix`. With no arguments it
covers `apps/**` and `packages/**` (except this package).

## React Native

`lucide-react-native` and `react-native-svg` are optional peers, not installed:
installing them pulls in all of React Native (~230 MB). Until `apps/mobile`
lands, `src/lucide-react-native.d.ts` declares just enough types for the native
entry to type-check. Delete it once the mobile app depends on the real package,
because an ambient module shadows the package's own types.
