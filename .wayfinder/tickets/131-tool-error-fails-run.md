---
id: "131"
title: "A bad or unavailable tool call should be an error the model reads, not a failed run"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

`packages/ai/src/agent/run-agent.ts`'s `onError` treats any tool error as the run's error. A model that calls a tool it doesn't have (e.g. `write` in plan mode, 106) or sends bad input fails the whole run, instead of getting a tool error it can recover from. The evals flagged the bad-input case earlier (088–093), and 106 hit the unavailable-tool case.

## Done when

- Unknown-tool and invalid-input calls come back to the model as tool errors (AI SDK `experimental_repairToolCall` or equivalent), and the run continues within its step limit.
- Plan mode: a `write` call gets a "not available while planning" error and the run still produces a plan.
- Unit tests plus an eval case; gate and e2e pass.
