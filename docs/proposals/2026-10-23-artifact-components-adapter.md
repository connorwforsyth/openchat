# Artifact components adapters (`components.tsx`): design note

Status: proposal for Connor's review. Nothing here is built.

## The problem

An instance can now restyle decks and sites with values: `brand/theme.css`
and `brand/kinds/<kind>/theme.css` set colours, radius and fonts, and
`DESIGN.md` tells the model the house style in prose. Values can't change
structure. A company that wants every title slide to carry its logo lock-up
in the corner, or every site to share one header, has no way to say so
except prose the model may ignore.

## The proposal

An optional `brand/kinds/<kind>/components.tsx` replaces or adds pieces in
the kind's component library (`@workspace/slide-ui` for decks,
`@workspace/site-ui` for sites). The model still imports from the same
module name; the runtime resolves that name to the library with the
instance's overrides layered on top.

```tsx
// brand/kinds/presentation/components.tsx
import { Title as BaseTitle, type TitleProps } from "@workspace/slide-ui/base";

export function Title(props: TitleProps) {
  return (
    <BaseTitle {...props}>
      <img alt="" src="data:image/svg+xml;…" style={{ height: 64 }} />
    </BaseTitle>
  );
}
```

### Rules

- **Same props, same names.** An override exports a component the library
  already has, with the same props type, or a new name the kind declares in
  its guide. A save check (the `SLIDE_UI_EXPORTS` list today) reads the
  override's exports, so the model is never told about a component that
  isn't there.
- **Runtime only.** The file is compiled and bundled by the artifact runtime
  at start (or on change), like the deck itself. It never reaches the
  model's context; only the export names and props do, through the guide.
- **Same sandbox.** The override runs in the runtime's sandboxed frame with
  the same module table: React and the library, no network.
- **Export mapping.** An override of a known piece keeps that piece's
  `data-slide-*` markers, so PowerPoint export still maps it natively. Anything
  else is pictured, as custom regions are today.

### Where it plugs in

- `apps/artifacts/src/presentation.ts` builds `slideModules`. It would merge
  the compiled override module over `slideUi` for the
  `@workspace/slide-ui` entry.
- `packages/artifacts-kit/src/kinds/presentation/slides.ts` reads the export
  list from the override (passed in as a port, as `Compile` is) so the save
  check and the guide agree with what renders.
- Sites follow the same path through `site-ui`.

## Open questions for Connor

1. Should overrides be allowed to add new components, or only replace the
   existing ones? Replace-only keeps the guide and export mapping simple.
2. Who may edit `components.tsx`: instance admins through the file system
   only, or also through the app later?
3. Is one file per kind enough, or should a team (space) have its own?

## Alternatives considered

- **More theme variables.** Cheap, but structure (a logo on every title)
  can't be a value.
- **Prose only (`DESIGN.md`).** Already shipped. It guides, it doesn't
  guarantee.
- **Per-deck templates the model copies.** Puts the house style in every
  deck's source, so a brand change means editing every deck.
