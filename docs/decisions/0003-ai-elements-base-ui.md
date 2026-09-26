# 0003: Migrating AI Elements to Base UI

- Status: accepted
- Date: 2026-09-26
- Ticket: [003](../../.wayfinder/tickets/003-risk-checks.md), `PLAN.md` §12 check 3; feeds
  [007](../../.wayfinder/tickets/007-ai-elements.md)
- Result: **PASS**. A small manual pass is still needed (listed below); nothing needs
  rebuilding from scratch.

## Context

D5: shadcn components first. AI Elements are used only where shadcn has no equivalent, then
converted to Base UI and owned. AI Elements is Radix-only; its Base UI variant
(vercel/ai-elements#450) is still **open**, last updated 2026-07-17. The §12 fallback is to
build those components on shadcn primitives ourselves.

## Check performed

1. Copied `packages/ui` (style `base-nova`, `@base-ui/react@1.8.0`, `shadcn@4.21.0`) to a
   scratch directory outside the repo. The real package was not touched.
2. Installed the five components ticket 007 expects to need, from the registry named in the
   AI Elements docs:

   ```sh
   bunx shadcn@4.21.0 add https://registry.ai-sdk.dev/{conversation,message,reasoning,tool,prompt-input}.json --yes --overwrite
   ```

   (`--overwrite` only to get past the prompt for the existing `button.tsx`; the replacement
   differed only in formatting and class order.)
3. Compared the raw registry source with what landed. Tallied imports. Ran `tsc --noEmit` with
   the repo's `react-library` tsconfig. Swept the result with the `migrate-radix-to-base`
   skill's reference tables (`consumer-props.md`, `menus.md`, `class-mapping.md`).

## Evidence

**The shadcn CLI does most of the migration.** The components' `registryDependencies`
(`button`, `tooltip`, `collapsible`, `dropdown-menu`, `hover-card`, `select`, `dialog`,
`command`, …) resolve against the project's own style. So they arrived as the **Base UI**
wrappers (`@base-ui/react/{button,tooltip,collapsible,menu,preview-card,select,dialog,…}`),
not Radix. The CLI also rewrote every `asChild` in the AI Elements source to Base UI's
`render` prop:

| Component | `asChild` in registry source | After install |
|---|---|---|
| message | 2 | 0 (`<TooltipTrigger render={…}>`) |
| prompt-input | 2 | 0 (`<HoverCardTrigger render={…}>`, `<DropdownMenuTrigger render={…}>`) |
| conversation, reasoning, tool | 0 | 0 |

The only Radix import left in 2,530 lines:
`reasoning.tsx: import { useControllableState } from "@radix-ui/react-use-controllable-state"`.
This is a small standalone React hook, not a primitive.

New runtime dependencies: `ai`, `streamdown`, `shiki`, `motion`, `nanoid`, `cmdk`,
`use-stick-to-bottom`, `@radix-ui/react-use-controllable-state`.

**`tsc --noEmit`: 10 errors, none of them structural:**

| File | Error | Cause and fix |
|---|---|---|
| prompt-input.tsx:1259-1263 (3) | `openDelay`/`closeDelay` not on `HoverCard` | Radix Root props. Base UI puts `delay`/`closeDelay` on the **Trigger** (consumer-props.md). |
| reasoning.tsx:173 | `dir: string` not assignable to `"auto" \| "ltr" \| "rtl"` | Collapsible content props spread into `<Streamdown>`. Stop spreading them. |
| reasoning.tsx:14, tool.tsx:21 (2) | relative import needs `.js` | Our tsconfig is `NodeNext`. Add extensions or use `@workspace/ui/...` aliases. |
| tool.tsx:43,54 (2) | unused `@ts-expect-error` | AI SDK 7 has the approval states now. Delete the directives. |
| prompt-input.tsx:1142-1143 (2) | `result` possibly undefined | Our `noUncheckedIndexedAccess`. Add a guard. |

**Silent behaviour issues** (they compile, so the skill's sweep caught them, not tsc):

- `prompt-input.tsx:410`: `DropdownMenuItem onSelect={(e) => { e.preventDefault(); … }}`.
  Base UI menu items use `onClick` plus `closeOnClick`. As installed, "Add photos or files"
  would never fire.
- `reasoning.tsx:168`, `tool.tsx:91,100`: `data-[state=open|closed]:` classes. Base UI sets
  `data-open`/`data-closed` (and `data-starting-style`/`data-ending-style`), so the collapse
  animation and the chevron rotation would silently stop.
- `useControllableState`: keep it as a declared dependency, or replace it with a local hook.
  007's "no `@radix-ui/*` import" rule means replacing it.

## Consequence for the plan

- **Keep D5 as written.** The fallback (building these on our own primitives) is not needed.
- **Ticket 007:**
  - Install with the shadcn CLI into `packages/ui` (style `base-nova`). The Base UI
    primitives and the `asChild`→`render` rewrite come for free.
  - Then apply the list above: 3 prop relocations, 1 `onSelect`→`onClick`, 3 class rewrites,
    1 hook replacement, 5 lint/type fixes.
  - Estimate: about half a day for the five components, plus the skill's "verify by hand"
    pass. Check the hover-card delay, menu close-on-click, and collapsible animation.
- Don't pass `--overwrite` in the real package. Answer "no" for existing wrappers so our
  formatted copies stay.
- When #450 merges, diff it against our copies as D5 says.
