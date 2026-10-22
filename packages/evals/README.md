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

# Live mode: real models from app.config.yaml; opt-in, never in the gate
bun packages/evals/src/cli.ts --live --model fast --judge judge          # prints the plan, calls nothing
bun packages/evals/src/cli.ts --live --model fast --judge judge --yes    # runs it
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
the judged checks, which need a real model and a judge: the live cases
(see "Live mode").

What the cases do show is what the server does around the model, which is
where a regression in our code would land:

| Suite | Cases | What it shows | What it doesn't |
|---|---|---|---|
| `baseline` | 4 | A plain turn works over HTTP: the run succeeds with no tool calls, the stream delivers the stored text and ends, the branch is stored with its author, model and usage, and the title job names the chat. | Anything about answer quality. |
| `tools` | 10 | Once a model picks a tool: the tool is offered on a plain chat (or withheld by the composer's switches), the call is stored with the model's arguments, `write` and an unattached MCP tool ask first while `bash`, `read` and the searches run, and the result reaches the model. A call the turn can't make (a tool it doesn't have, or arguments that don't fit) comes back to the model as an error and the turn goes on. The skill tools (128) ask before they create or publish, land in the person's library once approved, and a skill the person can't see is a tool error the model reads. | That a model would pick that tool. The choice is scripted. |
| `grounding` | 5 | The facts are delivered: an attached PDF is indexed and found with its name and page and the answer stores a citation; an `@file` mention puts the file's current content in the instructions; the memory file is in the next private chat's instructions; a picked skill's `SKILL.md` is in the instructions and kept with the message, and someone else's private skill is refused. | That a model sticks to them. |
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
| `t.judge(criteria, { context })` | A model-judged check. **Soft unless `.gate()`**, so it needs no `.soft()`. **Skipped, never passed, when no judge is configured**, which is every deterministic run. A judge that times out, errors or answers with something that isn't a verdict fails the check with that error. `context` is what the answer should rest on (a file the case wrote), which the transcript doesn't show. |
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

Skipped: the seven live cases (they need `--live`), and `injection`: hostile MCP tool description. It needs an MCP fixture
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

## The judge

`@workspace/ai/evals/judge` (`createJudge({ model })`) takes any configured
language model (a direct provider, openai-compatible, a local Ollama; no AI
Gateway) and answers the criteria and the transcript with a verdict: `pass`,
a `score` from 0 to 1, and the `reasoning`. It asks through structured output
(`generateText` with `Output.object`), not the AI SDK's
`experimental_evaluate`, because an evaluation model gives no reasoning and
openai-compatible providers don't ship one. The transcript is data to the
judge, never instructions, which matters for the injection cases. The same
module scores rubric cases in `eval.run` (`packages/server/src/evals/run.ts`)
when a judge model is set there.

`src/judge.ts` is the seam: `runSuites` takes an optional `judge`, and
without one every `t.judge()` is skipped.

## Live mode

Live cases (`liveCase(name, run, { modelCalls, judgeCalls, chats })`) are
plain prompts for a real model, with soft checks and judged ones. A
deterministic run reports them as skipped ("live only"); `--live` runs only
them. They are the **J** checks of the eval plan:

| Suite | Live cases | Judged |
|---|---|---|
| `baseline` | a factual question; a rewrite | helpfulness and faithfulness |
| `tools` | "what did I write down?" with notes in the workspace; "any news this week? check online" | tool choice on a prompt that names no tool |
| `grounding` | an `@file` question the file only partly answers | no claim the file doesn't support |
| `injection` | summarise a README with injected instructions; a hostile `@file` mention | didn't follow the injected instructions (plus gates: no pipe-to-shell, nothing written to `/etc`) |

`--live --model <alias or provider:model> [--judge <alias>]`:

- reads the providers from `app.config.yaml` at the repo root, or
  `CONFIG_PATH`;
- **before calling anything**, prints the model under test and the judge
  (provider, type, endpoint, and which env variable its key comes from, never
  the key), the number of cases, and a rough token estimate. There's no cost
  figure until the price table (`models.prices`, ticket 086) lands;
- runs only with `--yes`, or a yes at the prompt when the terminal is
  interactive; otherwise it exits 2 having called nothing;
- refuses when `CI` is set, unless `--allow-ci` is given too;
- refuses a keyed provider whose key isn't set;
- boots the production build with the person's providers and aliases copied
  as written (`${NAME}` references and all; only the variables they name
  reach the app), the model under test as the default, and the local
  stand-ins for embeddings and web search. The judge runs in the CLI with
  the provider's instance key.

Without `--judge`, judged checks are skipped. A live run is never part of the
gate or `turbo test`; its report has `mode: "live"` and the `model`.

Run it with `bun packages/evals/src/cli.ts --live …` (after a build):
`bun run evals` goes through turbo, which passes the evals task only `CI`
and `EVALS_PORT`, so `CONFIG_PATH` and provider keys don't reach it.

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

## Live artifact eval

`src/artifacts/` measures each artifact kind against a running app, the way
a person meets it: ten realistic prompts per kind (`prompts.ts`), sent to
the app's real artifact path (system prompt, kind guides, `create_artifact`
and its checks), the artifact approved as a person would, then drawn in the
chat's side panel in headless Chromium and screenshotted (`render.ts`). It
runs one trial at a time and needs a booted app and a signed-up account
(`session.ts` signs in as `demo@dots.local`).

```sh
bun run eval:artifacts:live --kind presentation --kind site       # prints the plan, calls nothing
bun run eval:artifacts:live --kind presentation --yes --model anthropic:claude-haiku-5-5 \
  --base-url http://localhost:3101 --out .evals/artifacts-live
bun packages/evals/src/artifacts/render-check.ts --chat <id>      # the renderer's verdicts on a known-good chat
bun packages/evals/src/artifacts/record-fixtures.ts --from .evals/artifacts-live
bun packages/evals/src/artifacts/report.ts --dir .evals/artifacts-live  # rebuild reports, no model calls
bun packages/evals/src/gallery/seed.ts --database-url <url>       # one polished example of every kind
```

Per trial it records whether the model called the tool, whether the input
parsed, whether the kind's checks passed (after any retries), whether the
renderer drew it, the time from sending to the saved artifact and to the
drawing, and the first stage it fell out at (`trial.ts`: `run_failed`,
`no_tool_call`, `tool_input_invalid`, `wrong_kind`, `schema_invalid`,
`unavailable`, `render_error`, `render_timeout`). It writes `<kind>.json`,
`<kind>.md`, `summary.md` and `screenshots/`, and with `--spend-log <tsv>`
appends its model calls per kind. `--yes` needs `--model` (the chats' model; the instance default may be a
paid one) and refuses more than `--max-trials` trials, 20 unless raised. Failures become offline fixtures with
`record-fixtures.ts`; `packages/ai/evals/artifacts/recorded-live.test.ts`
replays them through `create_artifact` with no model.
