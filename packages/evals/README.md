# Evals

A black-box eval harness over our own API (ticket 084; S3 of
`docs/proposals/2026-09-30-eve-assessment.md`). It boots the app the way the
end-to-end suite does (`e2e/support/serve.ts`: the production build on the
embedded database, with the mock model, search and MCP stand-ins) and drives
it over HTTP with the typed client, as any client would. There is no browser.

```sh
bun run evals                     # build apps/web, boot it, run every suite, report
bun run evals --strict            # the same, and exit non-zero if a gate failed
bun run evals --suite files       # one suite (repeatable)
bun run evals --list              # the suites and their cases
```

- It needs no keys and reaches no network: the model is
  `e2e/support/mock-llm.ts`, and the workspace is just-bash, which has no
  network at all.
- It boots on port 3184 (`EVALS_PORT` or `--port`), so it can run beside
  `bun dev` (3000) and the end-to-end suite (3100).
- It is its own turbo task (`evals`), like `test:e2e` and `eval`. It is not
  part of `test`. The local gate can add `bun run evals --strict`.
- A run takes under a minute on a laptop, most of it booting the server.
- `packages/ai/evals` (Evalite) is unchanged and still runs with
  `bun turbo eval`. Routing and the Decider stay there.

Skip the build with `bun packages/evals/src/cli.ts` when `apps/web` is
already built.

## What a deterministic case can and can't show

The model is a mock. It does exactly what the message tells it to:
`[tool:…]` and `plan(…)` make it call tools, `[script:…]` plays a fixed
script, and anything else is echoed. So **no case here shows that a model
chooses the right tool, stays grounded, or resists an injection.** Those are
the judged checks, which need a real model and a judge (ticket 085).

What the cases do show is what the server does around the model, which is
where a regression in our code would land:

| Suite | Cases | What it shows | What it doesn't |
|---|---|---|---|
| `baseline` | 4 | A plain turn works over HTTP: the run succeeds with no tool calls, the stream delivers the stored text and ends, the branch is stored with its author, model and usage, and the title job names the chat. | Anything about answer quality. |
| `tools` | 8 | Once a model picks a tool: the tool is offered on a plain chat (or withheld by the composer's switches), the call is stored with the model's arguments, `write` and an unattached MCP tool ask first while `bash`, `read` and the searches run, and the result reaches the model. | That a model would pick that tool. The choice is scripted. |
| `grounding` | 4 | The facts are delivered: an attached PDF is indexed and found with its name and page and the answer stores a citation; an `@file` mention puts the file's current content in the instructions; the memory file is in the next private chat's instructions. | That a model sticks to them. |
| `multi-turn` | 6 | A later turn is built from the right branch, with earlier tool results, nothing from a sibling branch, a regenerated answer beside the first; cancel-on-send leaves no change behind; a message sent mid-answer queues. | |
| `injection` | 7 | What the server allows a model that obeys injected text (the mock plays one): no write outside `/work` even when approved, changes wait for the person, approving one call approves no other. | That a real model resists the injection. |
| `isolation` | 10 | Tenancy by id on every route the app uses: 403/404 for another org's chat, runs, stream, workspace and uploads; nothing of it in search or `file_search`; memory per user and left out of shared chats; a viewer can only read. Each refusal has a control. | |
| `approvals` | 9 | The approval contract under every client: asked once per change, idempotent decisions, a 409 on a flip, Stop kills, a reload or second connection replays exactly what was live. | The cards themselves: `e2e/tests/harness.spec.ts` checks those in a browser. |
| `files` | 14 | The `/work` boundary for paths as text, the caps on big files and output, binary files. | |

Each suite carries this sentence as `proves`, and it is in the report.

A case should be able to fail. Before adding one, ask what change to the
server would turn it red; if the answer is "none, the mock would have to
change", it belongs in the mock's own tests or nowhere.

## Writing a case

```ts
import { call, plan } from "../src/mock";
import { defineSuite, evalCase } from "../src/suite";

export const example = defineSuite({
  cases: [
    evalCase("a write waits for approval, then lands", async (t) => {
      const asked = await t.send(
        plan(call("write", { content: "hi\n", path: "a.txt" })),
        { as: "ada" }
      );
      t.calledTool("write", { path: "a.txt" }).gate();
      t.check(asked.status, "run status").equals("awaiting_approval").gate();

      const done = await t.approve();
      t.check(done.status, "run status").equals("succeeded").gate();
      t.check(await t.readFile("a.txt"), "a.txt").equals("hi\n").gate();
      t.judge("The reply says what was written.").soft();
    }),
  ],
  name: "example",
  proves: "What these cases are really about, given a scripted model.",
});
```

Add the suite to `suites/index.ts`.

### Actions

`t` acts as one of three users made when the server boots (`src/world.ts`):
`ada` (the first sign-up, so the instance admin, and owner of both orgs),
`ben` (a member of Acme) and `dee` (a member of Globex, sharing nothing with
ben). A case's chat is created by its first `send`.

| | |
|---|---|
| `t.send(message, { as, mentions, attachments, run, parentId, wait })` | Starts a run and follows it until it stops moving: finished, or waiting on an approval. Returns a `Turn`. |
| `t.approve({ only })`, `t.reject(reason, { only })` | Decides the pending calls (or only some) and follows the run on. |
| `t.stop()` | Cancels the run, as Stop does. |
| `t.reload()` | What a page that just loaded sees: the stored branch, the runs still going, and the stream replayed from the start. |
| `t.files()`, `t.readFile(path)` | The chat's workspace files. |
| `t.regenerate()`, `t.settled()`, `t.streamOf(turn, { cursor })`, `t.newChat()` | The rest of what a client does. |
| `t.api(as)`, `t.statusOf(call)`, `t.eventually(read, done)` | The typed client for everything else, the HTTP status a call ends with, and polling for background work. |

Everything a `Turn` reports (`status`, `text`, `toolCalls`, `pending`) is
read back from the server, not taken from the stream; `turn.stream` is what
the run's SSE stream delivered while the case watched.

### Assertions

An assertion is built, then counted:

| | |
|---|---|
| `t.calledTool(name, args?, { in: turn })` | The model called `name`; `args` is a matcher (only the keys it names must match; values may be regular expressions or predicates). |
| `t.notCalledTool(name?, { in: turn })` | It didn't (or called no tool at all). |
| `t.check(value, label).includes(x)` / `.equals(x)` / `.matches(x)`, and `.not` | Any value the case read. |
| `t.judge(criteria)` | A model-judged check. **Skipped, never passed, when no judge is configured**, which is always, until ticket 085. |
| `.gate()` | The run must pass this. `--strict` fails on it. |
| `.soft()` | Reported, never failing the run. Judged checks are soft by default. |

An assertion that is built and never counted is an error, and so is a case
that asserts nothing: either would pass by saying nothing.

### Expected failures

When the behaviour a case expects doesn't exist yet, the assertion says so:

```ts
t.check(ranFreely, "the piped download ran without anyone being asked")
  .equals(false)
  .gate({ expectedFailure: "Not built: the floor rules are undecided." });
```

The check still runs. While it fails, the case is an `expected-failure`
(shown as `XFAIL`, with the reason) and doesn't fail the run. When it starts
passing, the case becomes an `unexpected-pass`, which `--strict` fails, so
the marker is removed when the gap is closed. Only the marked assertions are
excused: another gate failing in the same case is still a gate failure, and
a case that throws is an error.

A case that can't be written yet is `todo(name, reason)`: reported as
skipped, with the reason.

## Expected failures today

These are in the report on every run, with their reasons.

| Case | Why |
|---|---|
| `injection`: a download piped into a shell | Not built. The permissions proposal's floor rules are undecided; `bash` is `auto`, so `curl … \| sh` runs without anyone being asked. |
| `injection`: the `@file` wrapper | Hardening gap this suite found: a mentioned file's content goes into the instructions unescaped, so a file containing `</workspace-file>` closes its own wrapper. |
| `files`: symlink read escape | Known (074 left it out of scope): a symlink inside `/work` pointing outside is followed by `read`, `@file` and the Files route. |
| `files`: `@file` outside `/work` | Known (074's resolution): `@file` uses the loose path rule, so an absolute path outside `/work` is read into the instructions. |
| `files`: write through a linked directory (tool) | Bug this suite found: the run fails with `internal` and every later `bash` call in that chat fails too. |
| `files`: write through a linked directory (Files route) | Bug this suite found: `sandbox.writeFile` answers 500, and `sandbox.exec` on that workspace answers 500 from then on. |
| `files`: NUL in a path | Bug this suite found: a NUL in a tool call's arguments fails the whole run. |
| `files`: NUL in a file | The same bug from the other side: a tool result with a NUL (reading such a file) fails the run. |
| `tools`: arguments that don't fit the schema | Bug this suite found: the run fails (`couldn't store the answer's parts`) instead of the model getting an error. |

Skipped: `injection`: hostile MCP tool description. It needs an MCP fixture
whose tool description carries the injection; `@workspace/mcp`'s fixture has
fixed descriptions.

## Output

`.evals/<timestamp>/` at the repo root (gitignored):

- `report.json`: every suite, case, assertion and turn, with the totals
  (`src/report.ts` has the schema).
- `junit.xml`: gate failures and unexpected passes are failures; expected
  failures and skips are `skipped`, with the reason; soft failures are in
  `system-out`.
- `server.log`: what the app printed.

Without `--strict` the command only reports: it exits 0 whatever the cases
found, and non-zero only if it couldn't run at all.

## The judge seam

`src/judge.ts` defines `Judge`: a name and one function from the criteria
and the case's transcript to a verdict (`pass`, `reasoning`, an optional
`score`), as a `Result`. `runSuites` takes an optional `judge`. Ticket 085
implements it over an evaluation model and adds live mode; nothing else in
this package needs to change for that. Until then `t.judge()` is reported as
skipped, and the report says how many checks were.

## What the mock gained for this

Two additions to `e2e/support/mock-llm.ts`, both inert for the end-to-end
specs:

- `[plan:<base64url>]`: a script carried in the message (`plan()` writes
  it), so a case states the tool calls it needs rather than adding an entry
  to `SCRIPTS`.
- `[show:system]` and `[show:history]`: the mock answers with the
  instructions, or the conversation, the server sent it. This is how a case
  checks what reached the model (memory, mentions, the branch) without
  reading server internals.
