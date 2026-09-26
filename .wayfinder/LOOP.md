# The Wayfinder loop

Connor asked (2026-09-26) for a loop that works through the map until the whole
plan is built, pausing only at the human gates. This file is the procedure. Every
iteration follows it, so it survives compaction; don't re-derive it from chat
history. It is adapted from the doma loop that closed about 30 tickets.

Start it with `/loop` (no interval, self-paced) and the prompt:
"Follow `.wayfinder/LOOP.md` in ~/GitHub/openchat".

## Before anything

Read `.wayfinder/map.md` (Notes and the ownership register), then the parts of
`PLAN.md` the chosen tickets point at. `PLAN.md` is the spec. Once it exists,
`AGENTS.md` holds the coding conventions.

## One iteration

1. **Housekeeping first: merge what's green.** The repo is private on GitHub's free plan,
   so there's no branch protection and no auto-merge. The loop is the merge gate. For each
   open PR on a `t/*` branch (`gh pr list --search "head:t/"`), read `gh pr checks <n>` **once**:
   - **`ci` passed:** merge with `gh pr merge <n> --squash --delete-branch`, then record it (step 7).
   - **`ci` failed:** fix it on the same branch before taking new work.
   - **Still running:** leave it for the next iteration. Never wait or poll inside an iteration.
   - Never merge a PR that touches `packages/contract` after 008 closes (see Constraints).
   - Act on any answers Connor has written into `QUESTIONS-FOR-CONNOR.md` or into a ticket.
2. **Frontier.** Run `bun .wayfinder/frontier.ts`. Pick up to **3** tickets labelled
   `wayfinder:build`, `wayfinder:task` or `wayfinder:research`, in frontier order,
   **only if their Owns paths don't overlap** with each other or with a claimed ticket.
   - Skip `wayfinder:grilling` and `wayfinder:prototype` tickets: they need Connor.
     Add their open questions to `QUESTIONS-FOR-CONNOR.md` (one line each, with the
     ticket id), and don't decide them alone.
   - If nothing is takeable, go to **Stopping**.
3. **Claim and size.**
   - Set `assignee: loop` in each ticket's front matter, and commit the claims to `main`.
     Tracker-only commits are the one thing the loop pushes straight to `main`.
   - If a ticket is more than about a day of work, split it:
     - write sub-tickets (next free ids, same labels, `blockedBy` as needed), each with
       **Owns** and **Done when**;
     - link them from the parent under `## Split` (the parent closes when all its
       children have closed);
     - work the first sub-ticket.
4. **Do it through sub-agents.** For each ticket, create a worktree yourself:
   `git -C ~/GitHub/openchat worktree add ~/GitHub/openchat-worktrees/t-<id> -b t/<id>-<slug> origin/main`.
   (The Agent tool's `isolation: "worktree"` only works when the session's own folder is the
   repo, so don't rely on it.) Brief one general-purpose agent per ticket to work only in its
   worktree and commit there without pushing. Launch them in one message so they run in
   parallel. Each brief contains:
   - the ticket's full text, including **Owns** and **Done when**;
   - the paths to read (`PLAN.md` sections, `AGENTS.md`, `.wayfinder/map.md` Notes, and
     `node_modules/next/dist/docs` for anything in `apps/web`);
   - the constraints below, verbatim;
   - "Edit only the paths in Owns. If you must touch anything else, stop and report why."
5. **Verify each result yourself.** Don't trust the report. In the agent's worktree, run:
   - `bun install` and `bun turbo typecheck lint test build`;
   - the ticket's own **Done when** checks;
   - for `apps/web`: the production build, and that it boots with an empty `.env`.

   If something fails, send it back to the same agent (`SendMessage`) or fix it.
6. **Ship it.**
   1. Push the branch from its worktree and open a PR with `gh pr create --base main`. The body holds the
      ticket link, what was built, how it was verified, and the Claude Code attribution
      line (from the session's attribution reminder).
   2. Bind the PR with the ccd_pr tools (`get_status`, then `bind_pr` if needed).
   3. Don't merge yet. Connor asked for merge-on-green, and the next iteration's
      housekeeping merges it once `ci` has passed. **Don't poll CI.**
7. **Record it.** When a PR has merged (in housekeeping):
   - **In the ticket:** append `## Resolution (date, loop)`: what was built, where, how it
     was verified, the PR link, and what's left. Set `status: closed` and clear `assignee`.
   - **In the map:** add one line under *Built*.
   - **In `LOOP-LOG.md`:** one line (date · ticket · PR · outcome · verification).
   - Commit the tracker updates to `main`, and remove the worktree
     (`git worktree remove ~/GitHub/openchat-worktrees/t-<id>`).
8. **Re-arm.** Keep the chat output to a few lines per iteration. The context compacts
   on its own; everything worth keeping is in the tracker files.

## Constraints (every iteration, every sub-agent)

- **Never close a `grilling` or `prototype` ticket, and never answer an owner question.**
  Those are Connor's. Act on the answers once they appear.
- **Contracts are frozen after 008.** A change to `packages/contract` goes in its own PR,
  and gets a line in `QUESTIONS-FOR-CONNOR.md`. The loop never merges it; Connor does.
- **Never spend money or create paid accounts or resources.** Never print secrets.
- **The app boots with an empty `.env`.** Agent features work with no keys:
  - tests use `MockLanguageModelV4`;
  - local runs use Ollama if it's present.

  Degrade, never crash.
- **Code rules:**
  - zod-first types, `Result` errors, no classes outside adapters;
  - semantic tokens only;
  - icons via `@workspace/icons`;
  - strings via Lingui macros;
  - no stray `openchat` literals.
- **Git:**
  - never push code straight to `main`, and never force-push;
  - never commit `node_modules`, `.next`, `.turbo` or `.env*`;
  - never delete untracked files you didn't create. A doma agent once deleted `.agents/`
    this way.
- **Installs:** OSS only; no paid licences. New dependencies go through the bun `catalog`
  when they're shared.
- **Write like the surrounding code;** comments say why.

## Stopping

When the frontier has nothing the loop can do alone (only HITL tickets, owner questions,
or tickets blocked on them), and no loop PRs are still open:

1. Write a short summary at the top of `LOOP-LOG.md`: what closed, what's waiting on
   Connor, and the questions.
2. Send a push notification.
3. Stop the loop.

Expected stops: **008 Contract review**, the **009 and 010 prototypes**, and the
**026 M1 demo gate**. After 026, charting the waves (graduating them out of *Not yet
specified*) is a `/wayfinder` session with Connor, not a loop iteration.
