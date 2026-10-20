# Questions for Connor

Collected by agents working the map, so you can answer them in one sitting. Each links to its ticket. Answer inline and the loop picks the answers up.

## Waiting on you now

1. **M1 demo ([026](tickets/026-m1-demo-gate.md)):** run the `PLAN.md` §11 M1 checks yourself and close the ticket, or list what fails. Closing it lets us chart the waves in a `/wayfinder` session.
3. **Agent file changes in plain chats:** today `write`/`edit` always ask for approval. Suggested: creating a new file goes ahead without asking, and changing an existing file asks. *Default until you answer: keep asking.*
4. **Theme preset (002):** the scaffold uses shadcn's default preset. When you've picked one on ui.shadcn.com/create, paste the preset code here and the loop runs `shadcn apply`.
5. **Defaults below:** each item under "From the loop" has a default the loop already applied or will apply. Only answer the ones you disagree with.

Done: 009 and 010 prototypes, 042 contract PR (#31), Docker verification (045, PR #36), sandbox preview choices (047).

## From the loop

4. **Offline builds (002):** `next/font/google` downloads the Geist fonts at build time, so builds fail offline or in locked-down CI. Switch to the `geist` npm package (self-hosted fonts)? *Loop default if unanswered: yes, being done inside ticket 006.*
5. **Node version (002):** `engines` says Node `>=22` (this Mac has 22; CI and the containers use 24). OK? *Default: keep.*
6. **SearXNG image (002):** the compose file uses `searxng/searxng:latest`. Pin a version? *Default: pin to the current release when 021 (web search) lands.*
7. **gVisor (003, PARTIAL):** gVisor runs on Linux 5.6+ hosts (a normal VPS is fine) but can't be installed on Docker Desktop for macOS. The Docker sandbox on your Mac will fall back to plain `runc` with hardening and an admin warning, as `PLAN.md` D7 already says. Nothing to decide unless you want macOS sandboxes to use a Linux VM. [decision 0005](../docs/decisions/0005-gvisor-availability.md)
8. **bun linker for Expo (003):** Expo 57 works with bun's isolated linker (the repo's default), but `expo-doctor` warns about duplicates; the hoisted linker clears it. *Default: leave isolated; revisit in the Mobile wave.*
9. **Postgres version in tests (003):** PGlite is Postgres 18.3, production is 17. *Default: 011 adds a Postgres 17 job to CI for anything version-sensitive.*
10. **Status colours (007):** the theme has no success/warning tokens, so tool status uses the nearest semantic tokens. Add `--success` and `--warning` to `globals.css` (they'd come from your preset)? *Default: add them when you pick a preset.*
11. **RTL in shadcn primitives (007):** stock shadcn components still use physical `pl-`/`pr-`. Turn on shadcn's `rtl` option now, or in the open-source wave with the RTL pseudo-locale? *Default: open-source wave.*
12. **`/dev/*` routes (007):** the AI Elements demo at `/dev/ai-elements` is noindex but reachable in production. Gate `/dev/*` behind an env flag? *Default: gate it in 025 (integration).*
13. **Model proxy usage links (027):** should `/api/llm` requests carry an optional `conversationId`/`runId` so usage rows point at a chat? Adding it later is non-breaking. *Default: add it when the desktop wave builds the client.*
14. **Search language (011):** full-text search uses Postgres's `simple` configuration (no stemming, works for any language). `english` would match "running" to "run" but only for English. *Default: keep `simple` until other languages matter.*
15. **No database configured (011):** with an empty `DATABASE_URL`, should the app fall back to a file-backed embedded Postgres (PGlite in `./.data`) so `bun dev` works with zero setup? *Default: yes, done in 025 (integration).*
16. **Invitations without email (012):** there's no mail transport yet, so accepting an invite doesn't require a verified email. Anyone who knows an invited address could sign up with it and take the invite. Give invitations a separate random token (sent as a link), or add mail sending in M1? *Default: random invite token + link in M1; mail later.*
17. **Social sign-in config (012):** `auth.social.github` with unset env vars currently fails config validation, and env-only providers don't show in public config. *Default: fix in `packages/config` during 024 (settings/admin).*
18. **Personal org in lists (012):** `me.orgs` includes your personal org (flagged); `orgs.list` leaves it out. *Default: keep.*
19. **`auto` with no Decider opinion (013):** routes to the strong model. Cheap instead? *Default: strong (quality over cost).*
20. **Model proxy provider options (013):** the proxy strips a denylist of risky provider options. Drop call-level `providerOptions` entirely? *Default: keep the denylist.*
21. **Imported attachments (023):** exports don't contain the files, so attachments import as metadata-only `data` parts. Allow a file part with a "missing" source instead (contract change)? *Default: keep data parts.*
22. **Fork modes (023):** add a `mode` (direct path / include branches / target level) to the fork input (contract change)? *Default: direct path only for now.*
23. **Forking someone else's chat (023):** the copy should land in the forker's Personal context. *Default: yes, enforced in 025.*
24. **Local file links (021):** signed URLs for the local storage volume need a secret. *Default: derive it from `BETTER_AUTH_SECRET`.*
25. **Background embeddings (021):** which keys pay for ingestion embeddings? *Default: instance keys.*
26. **Serving files (021):** the download route sends `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. *Default: yes (025).*
27. **Artifact format (022):** the dev eval scores a `:::artifact{…}` block format. Adopt it for the artifacts prompt in 015? *Default: yes.*
28. **Telemetry content (022):** add `observability.recordContent` to config (off by default)? *Default: yes, small config PR.*
29. **Sandbox "unavailable" (019):** the contract's `sandbox` group has no 503 for "provider unavailable". *Default: map it to `FEATURE_DISABLED` in 025.*
30. **Terminal icon (019):** add `TerminalIcon` to the icon registry (the panel uses `ToolIcon`)? *Default: yes, in 015.*
31. **Shortcut storage (024):** personal shortcut overrides live in the browser because the contract's user settings have no field for them. Add a `shortcuts` field (contract PR) so they follow you across devices? *Default: yes, small contract PR after M1.*
32. **New default shortcuts (024):** ⌘, settings · ⌘. switch model · ⌘⇧; copy last reply (⌘⇧C is taken by devtools) · Esc stop. OK? *Default: yes.*
33. **Branch switcher at the ends (015):** stop at first/last (current) or wrap around (prototype)? *Default: stop.*
34. **Which fork `[` / `]` act on (015):** the most recent fork in the conversation. *Default: keep.*
35. **Undo for a first memory (015):** when there was no previous version, Undo clears the memory file. *Default: show Undo and clear.*
36. **Default agent vs chat editors (032):** an editor of a chat can't run the chat's default agent unless they can use that agent themselves. *Default: keep (least privilege).*
37. **Approving tool calls (032):** approving also requires being able to use the agent. *Default: keep.*
38. **Feedback in one request (031):** add a `feedback.list` procedure (contract PR) or turn on oRPC request batching? *Default: batching in 025 (no contract change).*
39. **Motion guard scope (031):** extend the guard from `packages/ui` to all of `apps/` and `packages/`? *Default: yes (it finds nothing today).*
40. **Android keyboard (031):** set viewport `interactive-widget=resizes-content` in `apps/web`? *Default: yes, in 025.*
41. **Artifact libraries (030):** React artifacts can import only react/react-dom. Allow a curated set (e.g. an icon set exempt from the icon guard, Tailwind's browser build)? *Default: add Tailwind browser + lucide for artifacts only, after M1.*
42. **Test chat retention (033):** builder test chats are deleted 24 h after their last message (pruned hourly). *Default: keep.*
43. **Duplicating skills (034):** duplicates still copy skill files and MCP/skill references without checking the copier can use them. Check and drop like knowledge files? *Default: yes, in the Agents+ wave.*
44. **Chat route bundle (039):** the chat route's first load (754 kB gzip) carries `ai`, `@ai-sdk/gateway`, zod locales and parse5 through chat-ui. Trim them? *Default: yes, after M1 (a lighter client-side message mapper).*
45. **Secrets generated at first boot (040):** the Docker entrypoint writes random `BETTER_AUTH_SECRET`/`ENCRYPTION_KEY` into the data volume when they're empty, so the quick start needs no `.env` edits. OK? *Default: yes (documented in self-hosting).*


## Answered 2026-10-01 (Connor, by voice)

- **Permissions (073):**
  - Balanced is the default preset, and the recommended bash tightening is accepted.
  - Risky commands in a sandbox are refused (not asked).
  - A plain Reject stops the run.
  - Grants last until revoked or 30 idle days, whichever comes first.
  - Q5 (co-editor answers), Q7 (Builder and Undo), Q8 (grant storage contract) and Q9 (preset by sandbox) were unclear. The loop re-explained them and defaults to its recommendations until he says otherwise: one-time only for co-editors; Undo before Builder; grants storage asked when built; Q9 parked.
- **Artifacts (#76):**
  - **The line:** agreed, artifacts are deliverables and files are working material.
  - **Order:** the Artifacts page plus Documents, then plan mode's Document, then Presentations and Spreadsheets. Add a **Sites** (microsite) feature.
  - **Site stack:** clean HTML + Tailwind with our theme, guided by a design.md, not the React UI kit. Fast.
  - **Network:** sites may fetch public resources (fonts, CDN imports) from an allowlist; otherwise locked down.
  - **Kind rules:** an artifact kind is "like a skill under the hood".
  - **No "Made in" label:** opening an artifact offers "Open chat".
  - Q18 (one artifact across chats) was re-explained; the loop's default is the same artifact.
  - The additive contract routes for the Artifacts page are approved.
- **Small PR calls:** all the loop's recommendations, plus Google's "G" mark. The gateway's `-highspeed`/`-ultraspeed` models fold into fast mode. A public "link previews on/off" flag is approved; password-protected share links are a later idea.
- **Other:**
  - "[" toggles the sidebar.
  - The voice proposal (104) goes next.
  - Start merging the review stack.
- **Contract:** Connor approved optional `reasoning`, `fast` and `mode` on run options.


## Answered 2026-10-02 (skills)

- Skills in chats: yes. Pick from the + menu and from `/`; agents load theirs on demand. The contract field for picked skills is approved (ticket 127).
- Also wanted: create, edit and publish skills from a chat (ticket 128). Compaction stays parked (082).

## Open (2026-10-02, from 124 and 127), defaults proposed

- 124: deleting a chat deletes its artifacts, duplicates included. Default: keep for now and revisit with Sites.
- 124: an artifact made in a shared chat belongs to the chat's owner. Default: keep.
- 127: a shared agent's attached skills are readable by people who can use the agent. Default: allow.
- 127: editing a message drops its skills. Default: keep them (small follow-up).
- 127: `/` in the real chat lists no prompt templates (never wired). Default: wire them (small follow-up).
- 128: publishing someone else's personal skill (with edit access) is refused from chat. Default: keep refusing.
- 128: every plain chat carries create/update/publish skill tools (each asks). Default: keep; gate behind a setting later if noisy.
- 125 (Sites): additive contract changes await approval: the `site` kind, `artifacts.siteOrigins` in public config, publish/unpublish/publication routes, the public `GET /published/{token}`, and save-workspace-folder-as-site. Suggestions: load the Sites instructions on demand (follow-up); accept that published sites share one origin for now.
- 133: a message sent *before* an approval card appears still queues behind a run that then pauses for approval (D25); it waits until you decide or Stop. Should #63's "a new message moves on" rule cover that too? Default: keep D25.
- 132: each tab keeps its own model pick for an open chat until reload. Default: keep.
- 126 (Documents, draft PR #109): additive contract changes await approval: the `document` kind, `ArtifactVersion.editedBy`, and `POST /artifacts/{id}/versions` (save a person's edit, `CONFLICT` on a stale base). Also: a person's version keeps the base version's chat and message (default: keep); the `markdown` kind is relabelled "Markdown" and Document replaces it in "Make something new" (default: keep); Chat opens the source chat rather than a side chat (default: keep for now).

## Answered 2026-10-02 (contracts)

- Connor approved both contract changes and said to merge: Sites (125, PR #105) and Documents (126, PR #109).
- 138 (image generation, branch `t/138-image-generation`): additive contract changes await approval: the `image` artifact kind, the `image-output` model capability, and optional `ModelOption.imageModel`. Also open: a per-call `model` argument, a per-turn image model picker, and forcing image generation like web search (a run option, which is a contract change).
- Connor approved the image generation contract changes (138) and said to merge.

## Open (2026-10-20, from 173–175 and 183: Dots engine and schedules, branch `t/182-dots-engine-ux`), defaults proposed

- **Can a schedule target any chat?** It currently can: any chat you can write, plus "a new chat each run". Default: keep. Runs on an ordinary chat are read-only unless you turn that off.
- **Which model answers a schedule on an ordinary chat?** It's the cheap `schedules.defaultModel` (the `fast` alias), not the chat's own model; ChatGPT's heartbeats use the thread's model. Default: cheap, for cost. The Dot's own schedules use the Dot's model.
- **Are the guardrail defaults right?** A 60-minute minimum interval, 24 runs a day (rolling 24 h, "Run now" included), 8 steps a run and 20k tokens a run. Schedules that predate 173 aren't re-checked against the minimum interval; only the daily cap limits them. Default: keep.
- **When should a schedule tell you by default?** New schedules use `important`: only `needs_attention` and failures notify. Migrated Dot schedules use `all`, as before. Default: keep.
- **What happens to extra Dots?** The migration keeps each owner's primary (or oldest) Dot. The others' chats stay as ordinary chats, and their schedules keep running on those chats; the spec said archive them. Default: keep them running, since nothing is lost.
- **Which shortcut opens the Dot?** Resolved in the demo integration (t/180-dots-ux): ⌘. opens the Dot (from 179), Switch model moved to ⇧⌘., and ⌘⇧D stays as a second Dot key.
- **Should the Dot be hidden from Recents?** The sidebar (t/181) hides it and pins it at the top. Default: hide.
- **Should the Proposed schedule card say Apply and Dismiss?** It uses the approval card's Approve and Reject, and there's no Edit on the card yet. Default: relabel later.
- **Event, webhook and monitor triggers** (from the Grok Bot and ChatGPT studies) are out of scope because each check is a paid model call. Approvals as their own message type, with plain-English rules, are a follow-up too.

## Open (2026-10-20, from the sidebar build 176–179), defaults applied

1. **Date headings ([177](tickets/177-sidebar-list-polish.md)):** ChatGPT's desktop app dropped them for a flat list. We kept Today / Yesterday / Previous 7 days / Older under "Last updated", and a flat list under "Created". *Assumption to confirm: keep the headings.*
2. **⌘. is your Dot, so Switch model moved to ⇧⌘. ([177](tickets/177-sidebar-list-polish.md)):** both can't have ⌘.. *Default: Dot gets ⌘. (as in ChatGPT); rebindable in settings.*
3. **Unread starts from first open ([176](tickets/176-sidebar-needs-attention.md)):** a chat you've never opened since this shipped (no read marker) counts as read, so old chats don't all light up. *Default: keep.*
4. **Running / awaiting approval for ordinary chats ([176](tickets/176-sidebar-needs-attention.md)):** the conversation list carries no run state, so "Needs attention" knows Dot runs (from `dots.list`) and the open chat's own run, not background runs in other chats. A `Conversation.attention` field (contract PR) would cover them. *Default: wait until you want it.*
5. **Not built tonight:** "Move" in the row menu (there are no projects to move to), ⌃Tab MRU switching (browsers keep ⌃Tab), ⌘1–9 row shortcuts (browsers keep them for tabs), draft rows and "hide but keep running" from the Grok study. *Default: follow-ups if you want them.*

## Spaces

Ticket [187](tickets/187-spaces.md). Resolved AFK from D17 so the demo could be built; each is a default you can overturn.

1. **Space = org + team tree** ([188](tickets/188-space-is-org-plus-team-tree.md)): a root space is an org, a sub-space is a team. No new tenancy tables; the UI and a new `spaces` API say "space". *Default: keep.*
2. **Visibility flows down only** ([189](tickets/189-space-visibility.md)): content shared to a space is visible in it and every sub-space below it, never up or sideways. Being in several spaces gives the union. *Default: keep.*
3. **Roles** ([190](tickets/190-space-roles.md)): owner, admin, member. A sub-space's owner is stored as team `admin`. No viewer role. *Default: keep.*
4. **Active space** ([191](tickets/191-active-space.md)): the sidebar switcher sets the context of new chats; remembered per browser. *Default: keep.*
5. **Allowance in tokens, not money** ([192](tickets/192-space-allowance.md)): a monthly token pool per space; members request a monthly grant, an owner approves or denies. *Default: keep.* The allowance is **not yet enforced before a run** (follow-up); runs are still gated by money budgets.
6. **Per-key usage** ([193](tickets/193-per-key-usage.md)): attributed when usage is recorded, to the newest key of the paying scope and provider. Earlier usage shows as "Unattributed". *Default: keep.*
7. **Sub-space members must already be in the root space** (as teams are today). Inviting someone straight into a sub-space would invite them to the root too. *Default: keep.*
8. **Contract** ([187a](tickets/187a-contract-spaces.md)): the additive `spaces` group awaits your approval (draft PR).

## The Dot's computer (PR #161 fix round)

1. **Who may open the computer's live view?** The noVNC view is served on the runner's preview origin at `{id}-6080.…`, with no token or session check. The `id` is an unsalted SHA-256 of `desktop:<conversationId>`, so anyone who holds that URL, or who knows the conversation id, can watch the screen and, while the owner has taken control, drive it. This predates PR #161, which only made sure input is off whenever the agent drives. A fix is a runner proxy change: a signed, short-lived preview token, or a salted id. *Default: leave it for a separate ticket on runner proxy auth; keep preview origins off the public internet until then.*
