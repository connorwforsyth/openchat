# Decision records

Short records of decisions that were checked rather than assumed. Each one has the context,
the check performed, the evidence (commands, output and versions), the result and what it
changes in `PLAN.md`. Number them in order and never reuse a number; when a later record
overrides an earlier one, set the old one's status to `superseded by NNNN`.

| # | Record | Result | Consequence |
|---|---|---|---|
| 0001 | [Drizzle 1.0 RC with Better Auth and PGlite (+ pgvector)](0001-drizzle-rc-better-auth-pglite.md) | PASS | Keep `drizzle-orm@1.0.0-rc.4`; use the adapter's `relations-v2` entry and `@electric-sql/pglite-pgvector` |
| 0002 | [bun with Expo autolinking and electron-builder native modules](0002-bun-expo-autolinking-electron-native.md) | PASS (caveats) | Keep bun; the Mobile wave decides the linker and does a real native build |
| 0003 | [Migrating AI Elements to Base UI](0003-ai-elements-base-ui.md) | PASS | shadcn CLI does most of it; a short manual list for ticket 007 |
| 0004 | [Next.js 16 standalone on Node 24 with Hono and unbuffered SSE](0004-next-standalone-hono-sse.md) | PASS | No change; streaming routes are Node + force-dynamic, send `X-Accel-Buffering: no` |
| 0005 | [gVisor (`runsc`) availability and the sandbox fallback](0005-gvisor-availability.md) | PARTIAL | runsc on Linux hosts only; runner detects it, else hardened runc with an admin warning |
| 0006 | [React Native Reusables on Expo SDK 57 with Uniwind](0006-rn-reusables-expo-57.md) | PASS (native) | Keep RNR + Uniwind; Uniwind breaks the Expo web bundle (not a target) |
