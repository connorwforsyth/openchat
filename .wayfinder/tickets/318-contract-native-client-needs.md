---
id: "318"
title: "Contract: what native clients need from config, and three responses that can't be null"
labels: [wayfinder:build]
status: open
map: "300"
assignee:
blockedBy: ["155"]
---

## Question

Its own PR, after [the API version and capabilities ticket](155-api-version-and-capabilities.md). From [Swift client research](306-swift-client-stack.md): public config gains `instanceId`, brand accent and font, and a `auth.native` capability. Write down the server-side rule: new union members and enum values are capability-gated or bump `apiVersion`, because a frozen Swift enum rejects unknown values. Optional, if cheap: `sandbox.get`, `artifacts.publication` and `feedback.get` return a whole `null`, which generated Swift clients can't decode; wrapping them (`{ sandbox: … | null }`) fixes that. The research calls this optional because the iOS app can avoid those calls in v1. Explain who needs it and what breaks (the web client's call sites, if the wrap is done). Connor merges it.

## Done when

The contract PR is merged by Connor.

## Owns

`packages/contract/**`.
