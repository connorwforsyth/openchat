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
- **What happens to extra Dots?** The migration keeps each owner's primary (or oldest) Dot. The others' chats stay as ordinary chats, and their schedules keep running on those chats; the spec said archive them. Default: keep them running. Since the #141 review fixes they run read-only like any chat schedule, keep the Dot's auto-approved tools, end their prompt with its instructions and rules, and stay paused if the Dot was off.
- **Should an extra Dot's schedules keep its model or agent?** They don't: a chat schedule runs on `schedules.defaultModel`, so a Dot that answered with a library agent loses that agent's instructions and tools, and its sandbox provider. Keeping them needs a target on the schedule, or chat schedules using the chat's own model. Default: no, as for every chat schedule.
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
5. **Allowance in tokens, not money** ([192](tickets/192-space-allowance.md)): a monthly token pool per space; members request a monthly grant, an owner approves or denies. *Default: keep.* It is enforced before a run, after money budgets, by one pool (`ALLOWANCE_SPENT`, 402; see item 10). **A space with no pool limits nobody**; otherwise every existing space chat would stop until an owner set one. *Default: keep.*
6. **Per-key usage** ([193](tickets/193-per-key-usage.md)): attributed when usage is recorded, to the newest key of the paying scope and provider. Earlier usage shows as "Unattributed". *Default: keep.*
7. **Sub-space members are always in the root space too** (as teams are today). A sub-space's members settings now invite someone straight in: the invitation adds them to the root space as a member and to the sub-space on accept. Only someone who manages the root space can send it; a sub-space owner who doesn't is told who can. *Default: keep.*
8. **Contract** ([187a](tickets/187a-contract-spaces.md)): the additive `spaces` group awaits your approval (draft PR).
9. **Space MCP policy** ([319](tickets/319-space-mcp-policy.md), not built yet): can a sub-space owner loosen a require or ban set above them? *Proposed default: no, rules only tighten down the tree.* Does a ban also hide a member's own library server in that space's chats? *Proposed default: yes; their personal chats are untouched.*
10. **Which pool limits a run** ([192](tickets/192-space-allowance.md)). A run is limited by the nearest pool among the chat's space and the spaces above it in which the person is a full member. Pools in spaces they aren't a member of don't apply to them, and if there's no such pool there's no token limit (money budgets still apply). Someone in a sub-space but not in its parent can't request an allowance from the parent, so its pool would otherwise lock them out with nowhere to ask. The limit is soft: usage is read, not reserved, so concurrent sends can overshoot, as with money budgets. *Defaulted, change if you disagree.* The alternative is to let sub-space members request from the spaces above them, so every pool on the way up applies.

## Demo polish (2026-10-21), defaults applied

1. **"Team & org" became "Spaces", not "Space".** The Library panel already has a "Space" link to the active space's page, and two "Space" entries side by side read as one. The tab lists items from every space you're in, so it says "Spaces"; the composer's agent group says "Space agents". *Default: keep. Tell us if you'd rather merge the two entries.*
2. **Not routed through `terms:`.** `terms:` only names features with their own settings address (today, MCP), and "Space" is already a plain string in about a dozen places. Making "Space" configurable is one change across all of them. *Default: a follow-up if you want forks to rename spaces.*
3. **Phone rows are 36px with a 40px tap area**, ChatGPT's density and under Apple's 44px. *Default: keep.*

## Dots guards (review fixes for #141), defaults applied

1. **How long does a one-off wait for a busy chat?** A one-off has no next slot to give way to, so it now waits on a busy chat (a run in flight or awaiting approval) for an hour from its time, then is skipped as `busy` and completes. A recurring slot still waits until the next one. *Default: an hour.*
2. **Should a run that can't start show in the history?** A failed start (no model, a revoked agent or share) shows only as the schedule's last outcome, `failed`. The history has no row for it, because a `ScheduleRun` is either a started run or a skipped slot, and it doesn't count toward the three-failures auto-pause. *Default: leave it; a contract change could add a "couldn't start" entry with its reason.*
3. **Reset the demo databases, or fix them by hand?** The one-Dot migration (174) was edited in place (#177), and drizzle tracks migrations by folder name, so a database that already ran the old version keeps its result. On the demo databases that means an extra Dot's schedules run with `read_only` false, without the Dot's instructions, rules or auto-approved tools, and keep firing even if the Dot was off. The extra Dot rows are deleted, so no later migration can recover what they held. *Default: reset the demo databases (drop, migrate, seed) before the next demo; nothing is fixed by hand.*

## The Dot's computer (PR #161 fix round)

1. **Who may open the computer's live view?** The noVNC view is served on the runner's preview origin at `{id}-6080.…`, with no token or session check. The `id` is an unsalted SHA-256 of `desktop:<conversationId>`, so anyone who holds that URL, or who knows the conversation id, can watch the screen and, while the owner has taken control, drive it. This predates PR #161, which only made sure input is off whenever the agent drives. A fix is a runner proxy change: a signed, short-lived preview token, or a salted id. *Default: leave it for a separate ticket on runner proxy auth; keep preview origins off the public internet until then.*

## Sign in with Microsoft (186, branch `pstack/entra-sso`), defaulted, change if you disagree

1. **Name.** Each Microsoft sign-in records the name it copied (`user.syncedName`). It updates the name only while the name still equals that record, so a name the person edited here stays. An account that existed before its first Microsoft sign-in keeps its name. *Defaulted, change if you disagree.* The alternative is to always follow the directory, as Better Auth does by default.
2. **Photo.** The same rule applies to the photo (`user.syncedImage`). When Microsoft returns no photo, the app removes the avatar it synced from Microsoft and keeps one the person set themselves. A failed Graph request changes nothing. *Defaulted, change if you disagree.* The alternative is to keep the last synced photo when Microsoft has none.
3. **`AvatarStore` port.** It lives in `packages/auth/src/ports/avatar-store.ts` with an in-memory fake beside it. A second port, `ProfileStore` (`ports/profile-store.ts`), reads the profile a sign-in would update. Both are in their own PR (`pstack/entra-sso-contract`). *Defaulted, change if you disagree.* The alternative is the server package, beside `Storage`.
4. **Which Microsoft emails count.** Any tenant's admin can give their users any email address (the nOAuth pattern). So Microsoft creates accounts on its own (`autoProvision`, `signup: sso`) only from a pinned tenant, meaning a specific `tenantId` or `allowedTenants`. An invitation or `signup: domain` matches a Microsoft email only from a pinned tenant, or when the token marks the email verified (Better Auth's `emailVerified`, from the `email_verified` or `verified_primary_email` claims). *Defaulted, change if you disagree.* The alternative is to trust only pinned tenants and ignore the verified-email claims.
5. **A directory email that changes.** Updated by the follow-ups lane (`pstack/followups-entra`). The account takes its email from the directory at sign-up and keeps it. A later sign-in leaves it alone, so a changed directory email can't take an address nobody here has yet, and it no longer collides with another account (the `microsoft_email_in_use` refusal is gone). *Defaulted, change if you disagree.* The alternatives: follow the directory while the email still equals the one the last sign-in copied, as name and photo do (needs a `syncedEmail` column, and still lets the directory take a free address), or refuse the sign-in when the directory's email changes.

## Usage and Langfuse

Lane `pstack/usage` (Settings → Usage, span tags). Defaults applied overnight; each is yours to overturn.

1. **Usage by chat is only for your own usage.** Space managers see usage by person, not by chat, because chat titles are private. The API refuses `groupBy: conversation` for a team or org. *Default: keep.*
2. **The Langfuse link is for instance admins only**, and it lives on the "By person" table. Its URL comes from `observability.userTracesUrl` (a template with `{userId}`), because a Langfuse user page needs a project id that can't be derived from the OTLP endpoint. *Default: keep.*
3. **Personal chats carry no space id on spans.** Only team and org chats get `langfuse.trace.metadata.space_id`. *Default: keep. Tagging the personal org id would take a lookup per run.*
4. **Not tagged yet: Decider calls, embeddings and image generation.** Chat runs and title calls are tagged; nothing else is. The Decider (`language-model-evaluator.ts`) and embeddings (`rag/embedder.ts`) sit behind ports (`Decider`, `Embedder`) that would need a `trace` argument, which is a port change in its own PR. Image generation (`tools/image-generation.ts`, `drawWith`) runs inside a tagged run, but the AI SDK's `generateImage` (ai 7.0.116) takes no telemetry options and makes no spans, so there is nothing to tag without a hand-made span. *Default: follow-up if you want it.*
5. **Names in usage follow what you can see.** A key is named only to someone `keys.list` would show it to (the key's owner, or an admin of the team or org that holds it). Everyone else sees "A key you don't manage". The contract row has no key scope, so the label can't say "Team key" or "Organization key" without a contract change. *Default: keep one neutral label. A `keyScope` field on summary rows would allow the finer wording.*
6. **Chats you lost access to.** "By chat" titles a chat only while you can still read it, and shows "A chat you no longer have access to" otherwise. The API marks a readable chat with no title yet as `label: ""`, because the frozen contract has no other way to tell it apart. *Default: keep. A contract field (say `access: "readable" | "lost"`) would make it explicit.*

## e2e-setup lane (pstack/fix-e2e-setup)

1. **Should an open artifact follow the model's new versions?** Opening a non-document artifact from its card pins that card's version, so after the model saves v2 the open canvas still shows v1 ("v1 of 2, read only"). `diagrams.spec.ts:60` and `presentations.spec.ts:73` expect it to follow, and fail on main as well. *Not defaulted, both left failing.* Either the canvas follows the newest version, or the specs click the newest card.
2. **List beside the open file at 1280px.** With the rail (181) the side panel gets about 480px at 1280px, under the 512px where the file list and the open file take turns (070). So on a common laptop width the list no longer sits beside the file. *Defaulted: the workspace specs run at 1440px.* The alternative is to change shell sizing (`fitShellColumns`) so 1280 keeps the list beside.
3. **An early ⌘K on a chat page is dropped.** Since 7867cca the palette owns ⌘K and loads after boot, so a press before it loads does nothing. *Not changed.* The alternative is to queue an early press and open the palette once it loads.

## run-queue-2 lane (pstack/fix-branch-queue)

1. **Where does a reply under a stopped queued question go?** You stop a question that was waiting behind an answer still being written, then reply under it. The reply now waits for that answer, and it stays under the stopped question, so the next answer sees both questions. *Defaulted: keep it under the stopped question.* The alternative is to move the reply under the answer being written, which drops the stopped question from the branch. That is one line in `placeRun`.

## brand-assets lane (pstack/brand-assets)

1. **Where should the logo show once you're signed in?** Nowhere visible today: the sidebar's top row is the space switcher (`Personal`) for every signed-in user, and the name is only its fallback while spaces load, so a logo there would flash. *Defaulted: the logo is on sign-in, sign-up and invitations, plus the tab and home-screen icons; the sidebar keeps the name.* Alternatives: the logo at the top of the rail, ChatGPT-style, turning into the sidebar toggle on hover (moves the toggle, which 181 keeps fixed); or the mark above "What can I help with?" (shifts the composer-first layout, D27).
2. **Tile colours for home-screen icons.** A one-colour mark is drawn white on `brand.iconBackground`, which defaults to black. *Defaulted: keep.* A fork with a light tile gives its mark its own colours; an `iconColor` field would cover the rest.

## slides lane (n2/slides stack)

1. **Where does the artifact runtime find the brand folder?** The runtime is its own service and doesn't read `app.config.yaml`, so its `theme.css` files come from `ARTIFACTS_BRAND_DIR`. The app reads `DESIGN.md` from `brand/` beside `app.config.yaml`, as it does the logo. *Defaulted: two sources, unset means no theme.* The alternative is a `brand.dir` config key the app passes to the runtime in each render message, so one setting covers both.
2. **Dark-mode theme values.** A `theme.css` that sets only `:root` leaves dark mode on the app's dark theme. *Defaulted: light uses `:root`, dark uses `.dark`.* The alternative is to let dark fall back to the file's light values where `.dark` sets none.
3. **Export quality PR (#228) is optional.** Ticket 164's export works; #228 fixes what it loses (gradient fills, rotation, opacity, native charts) and makes the PDF a picture of each slide with an invisible text layer. *Defaulted: opened last in the stack for you to take or drop.*

## night-2 fixes lane (n2/fix-*)

1. **Where does the sidebar go when there's no room to dock it?** With the side panel open on a narrow window, the toggle now shows the sidebar over the page, and it never appears on its own. *Defaulted: overlay on toggle only.* The alternative is for the toggle to close the panel to make room.
2. **Where do Restart and Reset sit on the Dot?** They are in a ⋯ menu beside "Computer" in the Dot's header, and in the computer panel's header. Reset asks first. *Defaulted: the menu.* The alternative is a visible Restart button beside "Computer", which costs header space.
3. **Schedules on ordinary chats.** The header's schedule button is gone from ordinary chats, so a chat's heartbeat schedule no longer shows "Next run …" there. It still shows on the Schedules page and in the sidebar row. *Defaulted: removed from the header everywhere but the Dot.*
4. **Can the model choose a schedule's emoji?** Schedules the agent proposes get ⏰, and only people pick another one. *Defaulted: no model choice*, which avoids validation retries on small models.

## menu lane (n2/menu)

1. **An `@agent` chip answers that one message, or switches the chat?** *Defaulted: that message only.* The server makes the chip's agent the run's target for the message (and its regenerate); the composer's picker keeps what the chat answers with. The alternative is to also set the chat's default target, so the next plain message goes to the agent too.
2. **Can a draft agent answer in an ordinary chat?** *Defaulted: yes, through its chip, for its owner only.* A draft is never offered in the target picker, since a chat whose default target is a draft becomes the builder's hidden test chat (033). The alternative is to keep drafts out of chats until published.
3. **Which artifact types the menu offers.** *Defaulted: the "Make something new" kinds (161): Slides, Site, Spreadsheet, Document, Diagram, SVG, Web page, React.* The alternative is every kind, Code and Mermaid included.
4. **What counts as Code-only in the menu.** *Defaulted: `/preview` only* (it runs a dev server). Chat mode keeps file commands, since Chat can read and edit files. The `modes` lane passes `mode` to the composer; that's the one hook.

## modes lane (n2/modes)

1. **What mode do chats from before modes get?** *Defaulted: Chat.* The migration gives every existing conversation `mode = 'chat'`, so an old chat that used `bash` loses it until someone switches it to Code. The alternative is to backfill `code` for chats that already have a sandbox, a one-line change in the migration.
2. **Plan mode in a Chat chat.** *Defaulted: plan mode keeps its rules, and Chat mode still removes `bash`.* A Chat plan therefore reads files but runs no read-only shell commands. The alternative is to let plan mode's read-only `bash` through in Chat.
3. **Where a message shows its mode.** *Defaulted: a quiet "Sent in Chat mode" or "Sent in Code mode" line under each user message.* The answer under it ran in the same mode. The alternative is to show it only when the mode changed from the message before, like the model switch marker (107).
4. **Who may switch.** *Defaulted: anyone who can write to the chat (owner and editors).* Code isn't gated by a policy yet. An operator setting to keep a team in Chat would be new config.

## modes-off lane (n2/modes-off)

1. **Chats made while `features.chatModes` is off, once it's back on.** *Decided (root, 2026-10-27): they're Code chats.* While the switch is off, a new chat (a fork, and a schedule's new chat, too) is stored with `mode = 'code'`, whatever the client asks, so turning the flag on later takes `bash` from none of them (`newChatMode`, n2/modes-off-followup). Chats from before modes keep the modes lane's default (Chat).

## editors lane (n2/editors)

1. **A published agent can carry draft skills.** The Skills section marks a skill "Draft" when it was never published, and a skill written inline is saved as the writer's own draft. Teammates using the published agent can't load someone's draft skill. *Defaulted: show the Draft badge, change no sharing rule.* Alternatives: publishing an agent offers to publish its draft skills with it, or the publish dialog warns and lists them.
2. **`{{current_date}}` is the UTC date.** The server fills it per turn without the user's time zone, so near midnight it can be a day off for the person chatting. *Defaulted: UTC, long English form ("Thursday, October 22, 2026").* The alternative is to send the browser's time zone with each run and format in it, which touches the run contract.
3. **Images in documents are by address only.** The `/` menu's Image asks for an https address or a path in this app; there's no upload from the document editor yet. *Defaulted: address only.* The alternative is an upload that stores the file and inserts its app path.

## slides-final lane (n2/slides-final)

1. **"Change this slide" posts a visible message in the deck's chat.** *Defaulted: yes.* The request ("Change slide 4 ("growth") of the presentation …") lands in the chat as a user message, so its reply, its approval and its edit sit with every other turn, and the editor follows the run. The alternative is a hidden instruction that only shows its result, which needs a new run input.
2. **One version per editing burst.** *Decided by root: coalesce.* The slides editor saves after 60 seconds without a change (`SAVE_IDLE_MS`), and at once before Change this slide and when the editor closes; the page warns before closing with edits unsaved. Documents, spreadsheets and diagrams keep their 800 ms pause. The alternative was one version per session.
3. **A colour of one's own is written into the slide as `#rrggbb`.** The theme's colours are offered first and written as `var(--…)`, so they follow the theme; a picked custom colour is a literal, which the slide guide tells the model not to write. *Defaulted: allow it for people.* The alternative is theme colours only.
4. **Undo after the agent's change.** *Defaulted: the agent's version joins the editor's history, so Undo takes it back (saved as a new version).* The alternative is that Undo only covers a person's own edits.

## prices lane (n2/prices)

1. **The curated Intelligence ratings are my judgment.** `packages/config/src/catalog/intelligence.ts` rates 27 models 1 to 5 by family tier (Opus and Fable 5, Sonnet 4, Haiku 5.5 3, GPT-5 4, Gemini 3.5 Flash 3, small Ollama models 1). *Defaulted: those values.* Change any line in that file, or override per model with `models.ratings` in app.config, or replace the file once a benchmark source (Artificial Analysis needs a key) is chosen.
2. **Long-context price tiers aren't applied.** models.dev lists them (Haiku 5.5 costs five times more above 100k tokens of context), but a run's usage is summed over its steps, so no single call's context size is known. *Defaulted: base rates, so a call over the threshold is under-counted.* The alternative is to record usage per step, which changes how runs settle.
3. **Cache writes are charged as input.** The recorded usage has no cache-write count (`tokenUsageSchema` in the contract), so Anthropic's 1.25x cache-write rate isn't charged. *Defaulted: input price.* Adding `cacheWriteTokens` is a contract change.
4. **No marker for estimated prices or ratings per row.** Usage rows don't record where their price came from, and the picker's ratings carry no source, so the UI says it once ("Costs are estimates at models.dev list prices unless this instance sets its own") instead of per row. A per-row marker needs a `priced`/`source` field on usage rows and on `ModelOption.ratings`, both contract changes. The contract's comment on `ModelOption.ratings` ("only what the config says; never guessed") is now stale for the same reason.
## n2-artifacts lane (n2/artifacts, n2/artifacts-panel)

1. **Does a new artifact reopen a panel you closed during the run?** Auto-open goes through the same path as clicking the artifact's card, so it opens a closed panel. The browser preview (066) stays shut if you closed the panel mid-run. *Defaulted: artifacts reopen it.* The alternative is to respect a mid-run close, as the Preview does, which is a one-line check in `chat-screen.tsx`.
2. **Should artifact approval stay on?** `create_artifact` asks before saving (`approval: "ask"`), so every artifact needs a click before it can auto-open. *Not changed.* Dropping the ask would let artifacts appear as the run makes them; saving is reversible (versions), unlike a file write.

## artifacts-surface lane (n2/artifacts-preview-fixes, n2/artifacts-surface)

1. **The header now has four controls, not three.** D14's "at most three controls" (Share, Files, Browser) gains Artifacts, as you asked for the T3 Code-style button. *Defaulted: four, with the count beside the icon.* The alternative is to fold Files and Browser into one Workspace toggle to keep three.
2. **A opens the artifacts list, not the panel.** A used to open the panel on the artifacts; the panel no longer lists them. *Defaulted: A toggles the popover; S still toggles the files.*
3. **No thumbnails on chat cards.** A card holds only a reference, so a picture costs a version fetch or a runtime render per card, and the app has no thumbnail service yet. *Defaulted: each kind's own icon and name; no picture.* The alternative is a small SVG and image thumbnail from the version, fetched when the card scrolls into view.
4. **A reload reopens the panel on the newest artifact, not the one you had open.** The layout stores the panel's section, not its selection (unchanged from before). *Defaulted: left as is.* Storing the selection per chat is a small follow-up.
5. **A deck without the artifacts service.** It opens on Preview and says the service isn't running, with Show the code. *Defaulted: same as React and sites.*
