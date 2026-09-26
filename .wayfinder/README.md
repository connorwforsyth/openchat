# Local-markdown wayfinder tracker

No issue tracker is configured for this repo, so wayfinder uses the
local-markdown tracker (the same conventions as the doma repo). Conventions:

- The map is `map.md` (label: `wayfinder:map`).
- Tickets are `tickets/<id>-<slug>.md`. Ids are zero-padded and monotonic; split
  sub-tickets take the next free id.
- Each ticket's front matter carries `id`, `title`, `labels`, `status`,
  `assignee` and `blockedBy`. Build tickets also have **Done when** and **Owns**
  sections: **Owns** lists the paths the ticket may edit, which is what lets
  tickets run in parallel.
- The **frontier** is every ticket where `status: open`, `assignee:` is empty,
  and every id in `blockedBy` is `status: closed`.
- A build ticket is closed only when its PR has **merged** into `main`.
- Resolutions are appended to the ticket under `## Resolution (date, who)`, and
  gisted into the map's *Decisions so far* (or *Built*) with a link.
- Labels: `wayfinder:build`, `wayfinder:task`, `wayfinder:research` (AFK),
  `wayfinder:grilling` and `wayfinder:prototype` (HITL: they need Connor).

The autonomous loop procedure is in `LOOP.md`; its log is `LOOP-LOG.md`; owner
questions collect in `QUESTIONS-FOR-CONNOR.md`. Research findings land in
`.context/research/`.

Query the frontier with:

```sh
bun .wayfinder/frontier.ts
```
