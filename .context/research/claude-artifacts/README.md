# How Claude's artifacts work (2026-10-16)

Read-only study for the artifact kinds roadmap (tickets 159–166). Sources: the
Claude Code CLI v2.1.300 (a Bun single-file executable whose embedded JS was
searched with rea and grep), the Claude desktop app's `app.asar`, and
Connor's screenshot of claude.ai's Artifacts page. The desktop app loads
claude.ai remotely, so claude.ai's chat artifacts (React with a fixed library
set) were **not** inspected: their runtime is served, not installed.

## The page (screenshot)

- "Artifacts" title, tabs All / Yours / Shared with you, search, list view,
  filters, ⋯.
- "Make something new": Docs (New), Slides (New), Design (New), Dashboard
  (Beta), each a card with an illustration.
- A grid of artifacts, each with a rendered thumbnail (a doc's first page, a
  deck's first slide, a page's top), a kind badge (doc or `</>`), the title,
  a lock for private and "Edited <date>".
- Docs have a serif title, a date chip and an @mention chip.

## Claude Code's Artifact tools

- Four tools: `Artifact`, plus thin wrappers `ArtifactComments`
  (comments, reply, resolve, watch), `ArtifactData` (`read_db`/`write_db`) and
  `ArtifactCheck` (`verify`, `preview`).
- Intents: `document | slides | design | other`. The model's first call is
  `action: "quickstart"` with the intent, "before loading a skill or writing a
  file".
- **Types are templates on the server.** A published artifact type ships an
  instructions file (`SKILL.md`), "loaded ahead of this turn for the
  artifact", and reference pages. A request for a deck or a document prefers
  a listed type "even over a skill that would produce it as a file format such
  as .pptx or .docx".
- **Design systems are artifacts too.** A default design system is "the
  user's own standing instruction" for every deck and design built with it.
- Built-in skills: `artifact-design` (the page contract), runtime
  capabilities, a workshop skill, `artifact-components` (a decision
  component read back with `read_page_data`) and `artifact-pr-review`.
- **Content is files.** One `.html` page (no `<html>`/`<head>`/`<body>`; the
  host wraps it in a skeleton) plus supporting files served beside it.
  Versions, a gallery title and description, an optional thumbnail
  (`<link rel="artifact-thumbnail">`, about 1200×630).
- **Libraries:** no npm list and no bundler. Scripts load as UMD globals from
  a CSP-enforced CDN allowlist (cdnjs preferred, jsDelivr, unpkg, Tailwind's
  play CDN, jQuery), at exact versions "at least two weeks old". Stylesheets
  only from Google Fonts. Mermaid renders natively.
- **Page rules:** responsive at about 400px, theme-aware through CSS tokens on
  `:root` with a `prefers-color-scheme` block and `[data-theme]` overrides, a
  2–4 word title, a size limit.
- **`ArtifactCheck preview`:** renders a local file in headless Chrome at
  1280 and 390 px, light and dark, and returns screenshots with a checklist
  (horizontal overflow, clipped content, theme-only colours). `verify` reads
  console errors and failed loads that viewers' browsers reported.
- **Data:** a per-artifact document store shaped like Firestore, with
  optimistic concurrency and access levels (view, interact, admin).

## Security

- One origin per artifact: `<slug>.frame.claudeusercontent.com`. The
  desktop app passes the theme to the frame as `?mode=dark|light`.
- CSP: `default-src 'self'`, scripts `'self' 'unsafe-inline' 'unsafe-eval'
  blob:`, `connect-src` only `'self'` and the font hosts, `object-src
  'none'`, WebRTC blocked.
- The frame refuses print, dialogs, downloads, nested frames,
  `window.open`, service workers and device APIs. `fetch` reaches only the
  artifact's own files. `localStorage` works but is per viewer.
- Runtime capabilities (`window.claude.use(...)`) are granted when the page
  opens: republish, a live room with the session, a database, the viewer's
  identity, MCP tools, asking Claude.

## What we take

- A kind brings its guide, loaded on demand: our `load_artifact_guide`
  (ticket 160) is `quickstart`.
- A starter card and a thumbnail for every kind (161).
- A screenshot preview check is worth building later.
- Where we differ: our libraries are workspace packages bundled into the
  runtime, not CDN globals, so a save can check imports and component names.
