# Design: an artifact framework

_Status (2026-10-01): a design for Connor to think through. Nothing here is built. It goes with `2026-10-01-files-artifacts-plan-mode.md`, which says why artifacts stay._

Connor (2026-10-01): "if we want to create a site … we could constrain it to work with particular rules etc., whereas the code / file area is a bit more open. I think we need a bit of an artefacts framework thing to think through it more deeply."

## The idea in one paragraph

The workspace is open. The agent can run anything in a sandbox, and the result only works there. An **artifact is constrained on purpose.** Its **kind** fixes what it may contain and which rules it follows, so it renders anywhere without a server: in the chat, in the library, on a phone, in a share link and in an export. A kind is a definition in one file, like a tool in S2's registry. It bundles six things:
- the content shape;
- the rules the model is told;
- the checks that enforce those rules;
- the operations the model edits with;
- how it renders, edits, diffs and exports;
- what it's allowed to do.

New kinds (presentations, spreadsheets) are new definitions, not new plumbing.

## What exists to build on

- **Storage:** `artifact` and `artifact_version` (`packages/db/src/schema/files.ts`), versioned, with a whole `content` text per version.
- **Kinds today:** html, react, svg, mermaid, markdown, code, as a string enum.
- **The runtime app** `apps/artifacts`, on its own origin (D24):
  - It renders React by transpiling with an import allowlist. Today that's `react` and `react-dom` only (`apps/artifacts/src/react-artifact.ts`).
  - It stamps `data-src` for Annotate (D16).
  - It renders Mermaid and documents.
- **Model tools:** `create_artifact` and `update_artifact`, from S0 and S2, which replace the whole content.
- **The pattern:** S1 (instructions as files) and S2 (one definition per tool) are the same idea this framework uses.

## A kind definition

```ts
// packages/artifacts-kit/src/kinds/site.ts (sketch)
export const site = defineArtifactKind({
  kind: "site",
  label: msg`Site`,
  icon: "globe",

  // 1. Content: what a version stores. Validated on every save.
  content: z.object({
    files: z.record(sitePath, z.string().max(200_000)), // index.tsx, components, styles
    entry: sitePath,
    assets: z.array(assetRef).max(50),                  // images, via the file store
  }),

  // 2. Rules the model is told: a prompt fragment, layered like S1's.
  instructions: "kinds/site.md",

  // 3. Rules that are enforced. Each check returns issues the model gets back to fix.
  checks: [
    importsAllowed(siteImports),     // react, our ui kit, lucide, recharts, …
    noNetwork({ allow: [] }),        // no fetch or XHR to the outside unless a rule allows it
    noStorageApis,                   // no localStorage or cookies (sandboxed origin)
    sizeLimit({ files: 40, bytes: 1_000_000 }),
    compiles,                        // transpiles in the runtime's compiler
  ],

  // 4. How the model edits, beyond replacing everything.
  operations: { writeFile, deleteFile, renameFile },

  // 5. Showing, editing, comparing, exporting.
  render: "runtime:site",             // apps/artifacts renders it
  editor: "code-tree",                // people edit files, or Annotate
  diff: "per-file",
  export: ["zip", "html-single-file"],

  // 6. What it may do.
  capabilities: { annotate: true, share: true, present: false, aiCalls: false },
});
```

**Who uses the definition:**
- the server, to validate a save and to build the model's tools and instructions;
- the runtime, to render;
- the client, to choose the viewer, editor and export menu;
- the library, to list and filter by kind.

## Kinds, and the rules each one carries

| Kind | Content | Key rules | Model edits | Person edits | Export |
|---|---|---|---|---|---|
| **Site** | files + entry | allowed imports only; no network; no storage; size caps; must compile; uses the instance's theme tokens | write, delete or rename a file | code tree, Annotate | .zip, single .html |
| **Document** | ProseMirror JSON (TipTap) | headings and structure; images from the file store only | structured edits (replace a section, insert a block); whole replace as a fallback | TipTap editor | .md, .pdf, .docx |
| **Presentation** | slides JSON: layout, blocks, notes | a fixed set of layouts; theme from the instance; text limits per layout | add, update, move or delete a slide | outline and text, layout picker | .pptx, .pdf |
| **Spreadsheet** | sheets, cells and formulas JSON | the formula subset we evaluate; size caps | set a range, add a sheet, set a formula | grid | .xlsx, .csv |
| **Diagram** | mermaid or svg source | parses; svg sanitized | whole replace | source | .svg, .png |
| **Snippet** | code + language | size cap | whole replace | code editor | file |

A Site is constrained where the workspace isn't. It is a front end that renders on the artifacts origin with our theme and a fixed set of libraries, and it never needs a server. A site that needs a backend stays in the workspace. Promoting it to an artifact means passing the Site checks, for example a static build.

## Rules come in layers

The rules for a kind come from four layers. Later layers can **narrow** what earlier ones allow, and can never **widen** it:

1. **The kind's defaults**, shipped in code: the allowed imports, the checks.
2. **The instance** (`app.config.yaml`, `artifacts.kinds.site`): extra allowed libraries, the brand theme, turning a kind off.
3. **The org or team**: house style, for example "sites use our design system, never inline colours".
4. **The agent** (library agents): kind templates and stricter rules for that agent's work.

**Instructions vs checks:** both sides of a layer are combined. Instructions are prompt fragments (S1's composer). Checks are code, plus a few declarative ones in config such as allowlists and size caps. The model is told the rules up front, and the checks hold even when it ignores them, so a failed check comes back as a tool error it can fix.

**Templates:** a kind can also ship starting points ("Landing page", "Pitch deck", "Budget sheet"). A template is a first version plus extra instructions.

## How a save works

1. The model calls a kind operation, or `create_artifact` with a kind.
2. The server applies it to the latest version and runs the kind's checks.
3. If a check fails, the model gets a tool error listing the issues, and nothing is saved.
4. If the checks pass, a new version is saved with its diff, and the card and library update.
5. A person's edit in the editor goes through the same checks and also saves a version. Annotate's resolve loop (D16) is the model making an edit against pinned feedback.
6. Approval follows the kind, and the permissions proposal decides it: for example, creating asks while editing your own artifact doesn't.

## Workspace and artifacts, side by side

- **Workspace (open):** any language and any tools, run in the sandbox, previewed in the built-in browser, gone when the sandbox is.
- **Artifact (constrained):** checked, versioned, portable and shareable, and kept in the library across chats.
- **Workspace to artifact:** "Save as artifact" runs the kind's import (for example, build a Vite app to static files, then run the Site checks).
- **Artifact to workspace:** "Open in workspace" copies the files into `/work` to go beyond the rules.

## Where it lives

- **`packages/artifacts-kit`** (new): `defineArtifactKind`, the kind definitions, shared checks, content schemas, and diff and export helpers. It is pure, so the server, the runtime and the client can all import it.
- **`apps/artifacts`:** renderers per kind, keyed by `render`.
- **`packages/chat-ui`:** the viewer and editor per kind, and the library page.
- **`packages/server`:** saving through checks, model tools generated from operations, and the list route for the library.

## Comparable products (from memory, to check before relying on them)

- **Claude's artifacts:** documents, code, HTML, SVG, Mermaid and React, with React limited to a fixed set of libraries and no browser storage. Artifacts can be published, and newer ones can call the model.
- **ChatGPT's canvas:** documents and code with inline editing and targeted edits rather than whole rewrites.
- **v0:** sites built on a fixed stack (React, Tailwind, shadcn).

The common thread is that a fixed stack and rules are what make an artifact render reliably and be shareable.

## The Artifacts page (Connor, 2026-10-01)

"There should be an artefacts navigation item that allows a user to view their created artefacts etc. and either register them in a chat, share them with others … maybe go to the chat that they came from?"

- **Navigation:** **Artifacts** gets its own item in the sidebar, next to New chat, Search and Library.
- **The page:** everything you made or that was shared with you, as a grid or a list.
  - Filters: kind, made by me / shared with me, and recently updated.
  - Search over title and content.
  - Opening one shows the kind's full-page viewer and editor, with its version history.
- **Use in a chat:** a "Use in chat" action, either into a new chat or into one you pick. It attaches the artifact by reference, the way an `@file` mention does, so the model sees its latest version and can make new versions of it from that chat. One artifact can be used from many chats, and each version records the chat that made it.
- **Share:** uses the same grants as library items (agents, prompts) — user, team or org; viewer or editor — rather than chat access. That means an artifact **is owned by a person** (and optionally a team or org), not by its chat.
- **Source chat:** "Made in …" links back to the chat that created it, shown only to people who can open that chat. Whether that's worth showing is an open question below.
- **References Connor shared (2026-10-01):**
  - **Claude's Artifacts page:** a serif page title; tabs All / Yours / Shared with you; search, grid/list and filter icons at the right; a "Make something new" row of kind cards (Document, Presentation, Design, each marked Beta); then a list grouped by date (Today, Yesterday, a date, a month). Each row has a kind icon, the title, a visibility mark (lock = private, globe = public), "Viewed 2h ago" and a ⋯ menu.
  - **ChatGPT's Sites page:** a title with a one-line subtitle ("Turn your ideas into live websites"); grid/list toggle, search and a primary **Create** button; tabs Owned by you / Shared with you; a table with a thumbnail, name and date, a "Shared with" column (Only you), an open-in-new-tab arrow and ⋯.
- **Our page, taking the best of both:**
  - **Header:** "Artifacts" title, then tabs **All / Yours / Shared with you**, with search, grid/list and a kind filter at the right.
  - **Make something new:** one card per enabled kind (Document, Presentation, Site, …), with Beta marks from the kind definition. Picking one starts a new chat with that kind's template and instructions, as Claude does. No separate blank editor first.
  - **The list:** grouped by date (Today, Yesterday, dates, months), sorted by **last viewed by you**. Each row: kind icon, or a **thumbnail** for Sites and Presentations, rendered by the runtime and cached; the title; a visibility mark (Only you / shared / public link); "Viewed …"; open in new tab; and ⋯ (Use in chat, Share, Rename, Go to chat, Duplicate, Delete).
  - **Grid view:** thumbnails large.
  - **Mobile:** the list only; the kind cards scroll sideways.
  - **"Viewed …" needs a per-person last-viewed time.** That's a small table (`artifact_view`: artifact, user, viewed_at), written when an artifact is opened.
- **Data changes:** the artifact gets an owner and grants. Versions keep their `messageId`, and gain a `conversationId` so a version made from another chat is traceable.

## Suggested order

1. **Framework and two kinds:** the kit, then Site (formalising today's html and react with checks and the theme) and Document (TipTap, structured edits). Migrate the existing kinds to definitions with no behaviour change, as S2 did for tools.
2. **The Artifacts page:** sidebar item, list, filter and search, use in chat, share (owner and grants).
3. **Rule layers in config,** then templates.
4. **Presentation,** then **Spreadsheet**.
5. **Capabilities** such as an artifact calling the model, only with the permissions proposal settled.

## Questions for Connor

1. **The core idea:** is "the kind defines the content shape, rules, checks, operations and rendering" the framework you had in mind?
2. **Site stack:** React with our UI kit, Tailwind with our tokens, lucide and recharts? Plain HTML as well? Anything else allowed by default?
3. **Who sets the rules:** should orgs and agents be able to add rules (house style), or only the instance admin at first?
4. **Network:** may a Site artifact ever fetch from the internet, say through an allowlist set by an admin, or never?
5. **Person edits:** should a person's edit to an artifact ask for anything, or just save a new version?
6. **Templates:** do you want them early (a landing page, a deck, a budget), or after the kinds settle?
7. ~~**Ownership:**~~ Decided (2026-10-01): artifacts are owned by a person and shared like library items, with their own Artifacts page in the sidebar.
8. **Source chat:** show "Made in <chat>" on an artifact (only to people who can open that chat), or leave it out?
9. **Use in chat:** when an artifact is used in a second chat and edited there, it's one artifact with versions from both chats. Or should using it in another chat make a copy?
