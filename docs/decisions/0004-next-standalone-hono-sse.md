# 0004: Next.js 16 standalone on Node 24 with Hono and unbuffered SSE

- Status: accepted
- Date: 2026-09-26
- Ticket: [003](../../.wayfinder/tickets/003-risk-checks.md), `PLAN.md` §12 check 4
- Result: **PASS**

## Context

D6 and D26: the `web` container runs Next.js `output: "standalone"` on Node 24 LTS, with the
Hono app mounted at `app/api/[[...route]]/route.ts`. Chat runs and participant events are
streamed over SSE (D25, §8). A buffering layer anywhere in that path would make streaming
arrive all at once.

## Check performed

A spike app outside the repo. `next@16.3.6`, `react@19.2.8`, `hono@4.13.9`, and
`next.config.ts` with `output: "standalone"`. The route file:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const app = new Hono().basePath("/api");
app.get("/sse", (c) =>
  streamSSE(c, async (stream) => {
    for (let i = 1; i <= 6; i++) {
      await stream.writeSSE({ event: "tick", id: String(i), data: JSON.stringify({ i, serverTs: Date.now() }) });
      await stream.sleep(500);
    }
  }),
);
export const GET = handle(app); // hono/vercel: (req) => app.fetch(req)
```

This machine's Node is 22.19.0. `npx -y node@24` supplied **Node v24.21.0**, which was used
for both the build and the server:

```sh
npx -y node@24 node_modules/next/dist/bin/next build
PORT=3917 HOSTNAME=127.0.0.1 npx -y node@24 .next/standalone/server.js
curl -sN http://127.0.0.1:3917/api/sse   # each line stamped with client ms on arrival
```

## Evidence

Build: `ƒ /api/[[...route]]` (dynamic), with `.next/standalone/server.js` emitted.
`/api/health` returned `{"ok":true,"node":"v24.21.0"}`.

Client arrival time (ms) next to each SSE line. Events land about 500 ms apart, each about
40 ms after the server timestamp. The stream is not buffered to the end:

```text
1790402768803  data: {"i":1,"serverTs":1790402768738}
1790402769304  data: {"i":2,"serverTs":1790402769239}
1790402769796  data: {"i":3,"serverTs":1790402769741}
1790402770295  data: {"i":4,"serverTs":1790402770242}
1790402770802  data: {"i":5,"serverTs":1790402770744}
1790402771303  data: {"i":6,"serverTs":1790402771245}
```

Response headers: `content-type: text/event-stream`, `cache-control: no-cache`,
`transfer-encoding: chunked`.

With `Accept-Encoding: gzip` (`curl --compressed`), Next's built-in compression left the
stream alone (no `content-encoding`), and events still arrived at 500 ms intervals.

## Consequence for the plan

- **No change to D6/D26.** Hono inside a Next route handler on Node 24 streams SSE
  incrementally from the standalone server.
- Every streaming route handler sets `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- Not covered here, and needed at deploy time: any reverse proxy in front of `web` must not
  buffer. For nginx, send `X-Accel-Buffering: no` from the SSE routes, or set
  `proxy_buffering off`. Add the header in the Hono SSE helper so every proxy setup gets it.
- The Dockerfile should pin `node:24` explicitly. Local dev machines on Node 22 still satisfy
  the repo's `engines` (`>=22`).
