---
id: "087"
title: "S3d: judge-quality spike (needs Connor: a local model or permission to spend)"
labels: [wayfinder:grilling]
status: open
assignee: 
blockedBy: ["085"]
---

## Question

Part of [081](081-evals-v2.md) (S3 of `docs/proposals/2026-09-30-eve-assessment.md`, section "S3 · Evals v2" and "Eval plan (S3)").
Before trusting judged scores: compare a judge against 30 hand-labelled cases and accept it at 80% agreement or better. It needs a live model. Ollama is not installed on Connor's machine, and the loop never spends money, so this waits for Connor to either install Ollama (free, local) or say which provider key may be used and a spending cap.

## Done when

- 30 hand-labelled cases (answer, criteria, expected verdict) checked in under `packages/evals`.
- Agreement measured for at least one judge model; the result and the recommended default judge are written in this ticket.
- If agreement is under 80%, judged checks stay soft and out of any gate, and the ticket says so.

## Owns

`packages/evals/judge-spike/**`.
