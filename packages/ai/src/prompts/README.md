# Prompts

What a model is told, as files. A turn's instructions are layers, composed in
this order by `composeInstructions` (`compose.ts`):

1. `base/NN-*.md`: what every turn gets, concatenated in filename order.
2. The agent's own instructions. These stay a database row (the agent
   version's `instructions`); they are not a file here.
3. Skills (127), from `fragments/skills.md`: each skill picked for the
   message, its `SKILL.md` wrapped in `<skill>` (source
   `skill:<itemId>@<versionId>`), and for an agent with skills attached, the
   list of their names and descriptions it loads them from with `load_skill`.
4. Fragments the turn calls for: `fragments/workspace.md` when a plain chat
   has a workspace; `fragments/plan.md`'s `planning` part instead of it for a
   planning run (plan mode, 106), and its `approved` part, holding the plan,
   for a run that approves one.
5. The instructions of the artifact kinds the turn may create (125), from
   their definitions in `@workspace/artifacts-kit`, when the turn has the
   artifact tools. A kind with empty instructions adds nothing.
6. `fragments/mentions.md`: the `@file` mentions in the message being answered.
7. `fragments/memory.md`: the user's memory file, in a private chat.

Layers are joined by one blank line, and a layer with no text is left out.
`composeInstructions` returns the final string and the sections it was built
from, each with its layer and source file.

## Editing a prompt

1. Edit the `.md` file.
2. Run `bun run prompts:generate` in `packages/ai`. It rewrites
   `generated.ts`, which is what the code imports.
3. Run the tests. `packages/server/src/runs/instructions.test.ts` snapshots
   the system prompt for each kind of turn, so its snapshot changes with your
   edit: update it (`vitest -u`) and say why in the commit.

Nothing reads these files at run time. `generated.ts` is checked in so that
Next, Vitest, Evalite, bun and the desktop and mobile bundles all get the same
strings with no bundler plugin; `generated.test.ts` fails if it's out of date.

## File format

A file's text is its content without the line breaks at its start and end.
Everything else, including spaces, reaches the model as written, so these
files hold prompt text only: no front matter, no notes to other authors.
Notes go in a README.

- `{{name}}` is a placeholder the code fills in per turn (`template.ts`).
- A line that is exactly `<!-- part: name -->` starts a named part. A file
  with parts is bundled as `{ parts: { name: text } }` instead of one string,
  for fragments that need several pieces (a wrapper, and the notes that go in
  it). The blank lines around a part aren't part of it.

## Today

This folder was introduced by ticket 079 without changing any prompt. The
base files and `fragments/artifacts.md` are empty: see `base/README.md`.
