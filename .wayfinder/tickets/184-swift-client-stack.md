---
id: "184"
title: "Does the generated Swift client, SSE parser and bearer sign-in work against our server?"
labels: [wayfinder:research]
status: closed
map: "179"
assignee:
blockedBy: []
---

## Question

Feed `packages/contract/openapi.json` to `swift-openapi-generator`: does it generate cleanly (oRPC's OpenAPI 3.1 output, unions, nullable, dates)? What needs tweaking, and in what (a generator config, an overlay, or a contract change)? Check the run stream's wire format (`/api/runs/*/stream`, cursor resume) and sketch the `AsyncSequence` parser. Check Better Auth: is `bearer()` enabled in `packages/auth`; how `ASWebAuthenticationSession` signs in with email and each social provider and hands back a token (a custom scheme callback? the `expo` plugin's pattern?); Keychain storage; and whether SSE/images/artifact iframes need short-lived tickets (`.context/research/t3code/remote-mobile.md` §5). Also `/api/config` for brand, API version and capabilities (ticket 155).

Findings: `.context/research/ios/swift-client.md` on branch `research/ios-swift-client`.

## Resolution (2026-10-20, research agent)

**Generation works, with a preprocessing step.** `swift-openapi-generator` 1.9.0 compiles our `openapi.json` but silently drops all 135 nullable fields (`anyOf [X, null]`) and ignores `const` (#261), so `MessagePart` and other unions lose their types while fixtures still "decode". A ~150-line preprocessing script in `apps/ios`, run before generation, fixes it: all 16 contract fixtures then decode into typed Swift. Swift alone can't send explicit `null`, decode three whole-null responses (`sandbox.get`, `artifacts.publication`, `feedback.get`), or tolerate new union members from a newer server. **Dates** need a custom decoder for millisecond timestamps. **Run stream:** `id: <seq>` / `data: <chunk>` / `[DONE]`, keep-alive every 15 s, resume with `?cursor=`; the runtime's SSE decoder handles it, but the chunk enum is hand-written (chunks are untyped in the contract). **Sign-in:** `bearer()` is on. Email is one `POST` returning `set-auth-token` (use a cookie-less session). For social/OIDC, a custom-scheme callback is refused today; recommended: a small `/auth/native` route + Better Auth `oneTimeToken()`, so the browser sheet returns only a 3-minute single-use token the app exchanges for a bearer. **No stream/view tickets needed in v1.** Suggests `/api/config` adds `instanceId`, brand accent and font, and a native-sign-in capability. Verified in the `swift:6.1` Docker image (no Xcode on this Mac); the SSE sketch isn't compiled; the artifacts WKWebView host is untested. Detail: `.context/research/ios/swift-client.md` on `research/ios-swift-client`.
