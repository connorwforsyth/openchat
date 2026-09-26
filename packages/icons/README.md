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
| phosphor | `sets/phosphor.ts` (all but `OctagonXIcon`) | not yet |
| tabler, hugeicons, material | not yet | not yet |

`ICON_SET` (default `lucide`) picks the set at build time; it stands in for
`app.config.yaml`'s `icons.set` until `packages/config` lands. The
`icons:select` script writes `src/selected.ts` and `src/selected.native.ts`
(gitignored), which are the package entries: each name is re-exported from
exactly one set file, so the other sets never reach the bundle. Names the
chosen set lacks come from lucide. Turbo runs `icons:select` before `build`,
`dev` and `typecheck` (and keys their caches on `ICON_SET`); `postinstall` runs
it once so editors resolve the package.

```sh
ICON_SET=phosphor bun turbo build --filter web
bun run icons:gaps     # per set and platform, which names fall back to lucide
```

To add a set, create `src/sets/<id>.ts` (and/or `<id>.native.ts`) exporting
`export const FooIcon = …` for the names it covers; the scripts discover it by
file name. Material Symbols should be generated as SVG components from
`@material-symbols/svg-{100..700}` (Apache-2.0), not the variable font.

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
