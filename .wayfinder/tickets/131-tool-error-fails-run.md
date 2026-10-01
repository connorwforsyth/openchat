---
id: "131"
title: "A bad or unavailable tool call should be an error the model reads, not a failed run"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

`packages/ai/src/agent/run-agent.ts`'s `onError` treats any tool error as the run's error. A model that calls a tool it doesn't have (e.g. `write` in plan mode, 106) or sends bad input fails the whole run, instead of getting a tool error it can recover from. The evals flagged the bad-input case earlier (088–093), and 106 hit the unavailable-tool case.

## Done when

- Unknown-tool and invalid-input calls come back to the model as tool errors (AI SDK `experimental_repairToolCall` or equivalent), and the run continues within its step limit.
- Plan mode: a `write` call gets a "not available while planning" error and the run still produces a plan.
- Unit tests plus an eval case; gate and e2e pass.

## Results (2026-10-02, loop)

On `t/131-tool-errors` (not pushed). Also closes [090](090-bad-tool-args-fail-runs.md), the same bug from the bad-input side.

**Root cause.** AI SDK 7 already handles both cases: a call to a tool the step doesn't have (left out of `tools` or `activeTools`) or with input that fails the schema is parsed as an invalid call (`NoSuchToolError` / `InvalidToolInputError`). The SDK answers it with a `tool-error`, which the model reads as `error-text` in the next step, and the loop goes on. Two things in our code turned that into a failed run:
1. `runAgent`'s `toUIMessageStream({ onError })` is called for the call's `tool-input-error` and `tool-output-error` chunks as well as for stream errors, and it set `failure` on every call. The UI also got "Something went wrong running the model." as the call's error.
2. `fromUIMessage` stored the call's `input` as `undefined`, because the SDK leaves `input` empty on a refused call's `output-error` part and puts what the model sent in `rawInput`. The contract rejects that, which is where 090's "couldn't store the answer's parts" came from.

**Fix** (`packages/ai/src/agent/run-agent.ts`, `packages/ai/src/messages/from-ui.ts`):
- `onError` treats `NoSuchToolError`, `InvalidToolInputError` and `ToolCallRepairError` as errors of the call, not the run, and shows the SDK's own message as the call's `errorText`. It doesn't include provider bodies. The call's second `onError` (the result chunk, which gets the error as a string) is matched to the first, so it doesn't fail the run either. All other errors, including a thrown `execute`, still fail the run as before.
- The stored call keeps the input the model sent (`rawInput`, or `null`). The stored result is `{ status: "error", message }`, the same shape as any other tool error, so the UI shows it the usual way ("Couldn't use frobnicate", then the reason). The next turn builds from it.
- New `RunAgentInput.unavailableTools` (name → reason). A `repairToolCall` that repairs nothing puts the reason on the `NoSuchToolError`, so the model reads, for example, "`write` isn't available while planning." in place of the SDK's list of available tools. Nothing passes it yet.

**Plan mode** (rebased onto 106, `8d809bb`). `planTurn` now names every tool it leaves out in `Turn.unavailableTools`, with the reason from `planUnavailable(name)` ("`write` isn't available while planning. Plan mode only reads; finish the plan, and the change can be made once it's approved."). The executor passes that to `runAgent`. The comment in `plan-mode.ts` no longer says the run fails. In `plan-mode.runs.test.ts`, the four "refuse a direct call to write/edit/update_memory/create_artifact" cases used to expect `failed`. Now each checks that nothing runs, the model reads the planning reason, the call and its error are stored, the run succeeds, and the plan artifact is saved. `plan-mode.test.ts` checks that `unavailableTools` lists exactly the tools left out. One edge: when a planning turn keeps no tools at all, `tools` is `undefined`. The SDK then refuses before any repair, so the model reads the SDK's "No tools are available." The run still continues.

**Tests.**
- `packages/ai` `run-agent.test.ts`: 6 new cases (unknown tool, reason for a withheld tool, a tool outside `activeTools`, invalid input, stored and rebuilt for the next turn, a step limit that still holds). They failed before the fix. Package total: 444 tests.
- `packages/server` `harness-gaps.test.ts`: 2 new end-to-end runs on PGlite (web search switched off but called anyway, and `web_search` with bad input). Both failed before the fix. There are also the plan-mode cases above. Package total after the rebase: 517 tests.
- Evals: the 090 case in `tools` ("arguments that don't fit…") is a plain gate now. A new case covers an unknown tool, plus `write` with the workspace switched off. Its README is updated. `tools`: 9 passed, 2 live skipped. `evals --strict` is ok.
- e2e: the mock can now make a call the turn doesn't offer (`unoffered`, script `unknown-tool`). `tools.spec.ts` checks the error card, the stored call and its error, the answer, and the same after a reload.
- `gate.sh`: install, check, guards and `turbo typecheck lint test build` all pass (92/92 tasks), and `evals --strict` is ok. Full e2e on port 3288: 73 passed and 2 failed. The failures were `composer.spec` thinking/fast (known flaky) and `chat-markers.spec` "switching model mid-chat marks the switch once". Both passed on a rerun.

**Open.** A tool whose `execute` throws still fails the run, because `onError` can't tell it apart from a stream error. Our own tools return errors as values, so it should be rare. Deciding whether a thrown tool error should also go back to the model is a separate question.

**Possibly flaky:** `chat-markers.spec` "switching model mid-chat marks the switch once" failed once in the first full e2e run and passed on a rerun. It isn't on the known-flaky list yet. Left unchanged.
