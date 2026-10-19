---
id: "184"
title: "Does the generated Swift client, SSE parser and bearer sign-in work against our server?"
labels: [wayfinder:research]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

Feed `packages/contract/openapi.json` to `swift-openapi-generator`: does it generate cleanly (oRPC's OpenAPI 3.1 output, unions, nullable, dates)? What needs tweaking, and in what (a generator config, an overlay, or a contract change)? Check the run stream's wire format (`/api/runs/*/stream`, cursor resume) and sketch the `AsyncSequence` parser. Check Better Auth: is `bearer()` enabled in `packages/auth`; how `ASWebAuthenticationSession` signs in with email and each social provider and hands back a token (a custom scheme callback? the `expo` plugin's pattern?); Keychain storage; and whether SSE/images/artifact iframes need short-lived tickets (`.context/research/t3code/remote-mobile.md` §5). Also `/api/config` for brand, API version and capabilities (ticket 155).

Findings: `.context/research/ios/swift-client.md` on branch `research/ios-swift-client`.
