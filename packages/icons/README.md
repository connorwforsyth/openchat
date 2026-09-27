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
both relative to `apps/web`. `ICON_SET`, `ICON_STYLE`, `ICON_WEIGHT` and
`ICON_FILL` override it (a Docker image is built before its config is
mounted, so it gets them as build args; see `docs/self-hosting.md`).

The `icons:select` script writes `src/selected.ts` and `src/selected.native.ts`
(gitignored), which are the package entries: each name is re-exported from
exactly one set file, so the other sets never reach the bundle. Names the
chosen set lacks come from lucide, and only those. Turbo runs `icons:select`
before `build`, `dev` and `typecheck`, keyed on those variables, `CONFIG_PATH`
and the config at `apps/web/app.config.yaml` (or the repo root); a config
elsewhere isn't hashed, so run with `--force` after editing its `icons`
block. `postinstall` runs it once so editors resolve the package.

```sh
ICON_SET=material ICON_STYLE=rounded bun turbo build --filter web
bun run icons:gaps     # per set and platform, which names fall back to lucide
```

To add a set, create `src/sets/<id>.ts` (and/or `<id>.native.ts`) exporting
`export const FooIcon = …` for the names it covers; the scripts discover it by
file name.

### Material Symbols

`sets/material.ts` maps names to symbols as `fromMaterial(glyph.<symbol>)`.
The path data comes from `src/sets/material.glyphs.ts`, which `icons:select`
generates (gitignored) from `@material-symbols/svg-<weight>` (Apache-2.0) in
the configured style (`outlined`, `rounded`, `sharp`; default `outlined`),
weight (100–700; default 400) and fill: SVG paths rather than the variable
font, so each icon costs a few hundred bytes and unused ones drop out. To map
another name, add a line with the symbol's name from
[the catalogue](https://fonts.google.com/icons); `sets.test.ts` checks it
exists in every variant.

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
