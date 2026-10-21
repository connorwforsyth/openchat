# Web app verification map

This directory is the maintained source for verifying what a user sees and
does in `apps/web`. Read this index before driving the app, then use the
matching feature file as the recipe. `../SKILL.md` covers launch, doctor and
cleanup.

## Baseline preconditions

- An instance started by `scripts/launch.sh` in this run, on its own port
  (3100 by default, never 3000), with an empty embedded database and the
  mock model server as its only provider.
- `scripts/doctor.sh` ends with `doctor: HEALTHY http://localhost:<port>`.
- The `accounts` journey has run once on this instance, making
  `ada@e2e.test` (`Ada Admin`) the admin. `scripts/journey.sh` does this
  automatically.
- Never drive an instance this run did not start.

## Driving conventions

- Run journeys with `.claude/skills/verify-web/scripts/journey.sh <name>`.
- Prefer ARIA roles and accessible names (see SKILL.md "Drive"), and the
  shared handles in `journeys/handles.ts` (`sidebar`, `rail`, `chatRow`,
  `settings`).
- Every model reply comes from the mock. Plain text echoes as
  `Echo: <text>`, and titles are `Topic <first three words>`. Never point a
  journey at a paid provider.
- Put a fresh tag in any text a journey searches for, so reruns on the same
  instance don't produce duplicate matches.

## Proof and skip reporting

- UI proof is a screenshot and an ARIA snapshot per step, under
  `$RUN_DIR/evidence/<feature>/`.
- Mutation proof includes a read-back via `apiFor` or a second view (reload,
  Settings), saved as `<step>.json` or as a later step's snapshot.
- Report an entry point you didn't drive as unverified. Don't count a
  different path as covering it.
- Report a failing journey with its `evidence/test-results/*/trace.zip`.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the user-visible
behaviour, then exactly four H2s in this order: `Sub-features`,
`How to get to it (user POV)`, `Driving it with verify-web`, `Gotchas`.

## Features

- [Accounts](./accounts.md): first sign-up becomes admin, sign out, sign in.
  Journey `accounts`.
- [Chat](./chat.md): a new chat streams a reply, gets a title, survives a
  reload, takes a second turn. Journey `chat`.
- [Sidebar](./sidebar.md): chats list by title, keep it across an
  immediate reload, open from a row, rename from the row menu. Journey
  `sidebar`.
- [Rail and panels](./rail.md): the rail switches the panel between Chats,
  Scheduled, Library and Artifacts; space switcher; Dot entry; collapse
  survives a reload. Journey `rail`.
- [Full-screen settings](./settings.md): open from the account menu, `Mod+,`
  and the address; switch sections; change the sidebar layout; close back.
  Journey `settings`.
- [Command palette](./palette.md): `Search chats` finds a chat by its text,
  opens it, runs `Open settings`; one ⌘K keeps it open. Journey `palette`.
- [Brand assets](./brand.md): the logo follows the app theme on sign-in;
  tab icon, Apple icon and manifest icons. Journey `brand`.
- [Memory](./memory.md): "remember …" saves to memory, shows in Settings ›
  Memory, Undo reverts. Journey `memory`.

Not mapped yet (candidates, each with an e2e spec to crib from in
`e2e/tests/`): Dots beyond the onboarding entry (`/dots`, which makes a
model call on its last step), schedules (`/schedules?edit=new`), spaces and
Space settings (`orgs.spec.ts`), files and attachments (`files.spec.ts`),
artifacts (`artifacts.spec.ts`), library agents and skills
(`skills.spec.ts`, `sharing.spec.ts`), the workspace panel
(`workspace*.spec.ts`), plan mode (`plan-mode.spec.ts`), quick chat
(`quick.spec.ts`), and the phone drawer (`phone-sidebar.spec.ts`).
