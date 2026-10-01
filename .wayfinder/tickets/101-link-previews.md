---
id: "101"
title: "Sources show the site's favicon, and an OG preview card on hover"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-01): when a web search returns references, each should have the source's favicon, and a card previewing the page, preferably from its OG information. Today `Sources` (`packages/chat-ui/src/conversation/sources.tsx`) shows each URL citation as a chip with its title or host. A `url` citation carries only `url` and an optional `title` (`citationSchema` in `packages/contract/src/schemas/message-parts.ts`).

Connor approved (2026-10-01) a new read-only route in `packages/contract` for server-side link previews. Browsers never contact cited sites directly.

## Done when

- **Contract (additive):** `GET /link-preview?url=` returns `{ url, finalUrl, title?, description?, siteName?, image?: { url, width?, height?, alt? }, icon?: url, fetchedAt }`, where `image.url` and `icon` point at our own image route. Then `GET /link-preview/image?src=<signed>` streams a cached, size-capped image. Both need a signed-in user. Old clients are unaffected.
- **Server fetcher** in its own module, with tests:
  - **URLs:** http(s) only. Resolve DNS and refuse private, loopback, link-local, CGNAT, multicast and cloud-metadata addresses (IPv4 and IPv6, including IPv4-mapped). Re-check on every redirect, at most 3, and pin the connection to the checked address so DNS rebinding can't swap it.
  - **Limits:** 5s timeout, at most 1 MB of HTML read (stop at `</head>` when possible), `text/html` only. Images under 2 MB and `image/*` only; SVG is either refused or served as an attachment, never inline.
  - **Parsing:** `og:*`, `twitter:*`, `<title>`, `<meta name=description>`, and `<link rel=icon|apple-touch-icon>` (best size), falling back to `/favicon.ico`. Strip markup and cap text lengths.
  - **Caching:** previews per URL for 24h (successes) or 1h (failures), in Postgres or an LRU behind a port — say which. Images are cached by hash. Requests per user are rate-limited.
  - **Signed image URLs:** the image route only serves URLs a preview produced, signed with the instance secret, so it isn't an open proxy.
- **Config:** `features.linkPreviews` (default on). When off, chips show the host and no card, and nothing is fetched.
- **UI:**
  - Each URL source chip shows the favicon (16px, rounded, letter fallback) before the site name.
  - Hovering or focusing a chip opens a card (Base UI `PreviewCard` from `packages/ui`, styled like the 099 preview pane) with the image (16:9, cropped, a blurred-out fallback when there's none), site name with favicon, title, two-line description and host. Click opens the page in a new tab (`rel="noopener noreferrer"`).
  - Previews load lazily, when the chip is near the viewport.
  - Touch: tap opens the card, which has an Open link.
- **Tests:**
  - SSRF cases: localhost, 127.0.0.1, `[::1]`, 169.254.169.254, a public name resolving to 10.0.0.5, a redirect to a private address, a non-HTML response, an oversize body.
  - The parser over fixture pages, caching, the image route refusing unsigned sources, a contract round trip, and the chip and card components.
  - e2e with a local fixture site served by the test harness on an allowed host (add a test-only allowlist so the fixture can be fetched — never in production config).
- Gate and e2e pass.

## Owns

`packages/contract/src/routes/*` and `schemas/*` (the new route and schema only), `packages/server/src/link-preview/**` (new) and its router wiring, `packages/config/src/schema.ts` (`features.linkPreviews`), `packages/chat-ui/src/conversation/sources.tsx` and a new `link-preview` component, `packages/ui/src/components/**` (a preview card primitive if needed), `e2e/**` (fixture site and spec), `docs/self-hosting.md`.

## Results (2026-10-01, loop)

Built on `t/101-link-previews` (not pushed). Contract change is its own commit (`7f333e1`) so it can go up as its own PR.

- **Contract (additive):** `linkPreviews.get` (`GET /link-preview?url=`) and `linkPreviews.image` (`GET /link-preview/image?src=`, a detailed output with a raster `image/*` file body and inert headers), schema `schemas/link-preview.ts`, tag "Link previews", README change table, regenerated `openapi.json`. Nothing else in `packages/contract`.
- **Server** (`packages/server/src/link-preview/`): `safe-fetch.ts` (http(s), default ports, no credentials; every DNS answer must pass `address.ts`'s IPv4/IPv6 range check incl. mapped/NAT64/6to4/CGNAT/metadata; re-checked on each of at most 3 redirects; socket pinned to the checked address via a custom `lookup`; 5 s deadline over the whole exchange; 1 MB HTML stopping at `</head>`, 2 MB images, caps after decompression), `parse-head.ts` (hand-written tokenizer, no dependency), `service.ts` (in-memory LRU behind `TtlCache`: previews 24 h, failures 1 h, images by SHA-256 of URL, 32 MB; single-flight), `signing.ts` (HMAC tokens with 7-day expiry, key derived from `BETTER_AUTH_SECRET`, random per process without it), `image-type.ts` (magic-byte sniffing, SVG never served), `rate-limit.ts` (120 previews and 300 images per user per minute), `router.ts`, `from-env.ts`. `test-allowlist.ts`: `LINK_PREVIEW_TEST_ALLOW_ORIGINS`, exact loopback http origins only, ignored in production unless `BETTER_AUTH_URL` is itself loopback (the e2e harness).
- **Config:** `features.linkPreviews` (default true), server-side only: kept out of the public feature flags (the contract's record is exhaustive), so `public.ts` now picks the public flags.
- **UI:** `chat-ui/src/conversation/link-preview.tsx` (`UrlSourceChip`, `LinkPreviewCard`, `Favicon`, HTTP loader with a provider for tests); `sources.tsx` uses it. Uses the existing `HoverCard` (Base UI PreviewCard) from `packages/ui`; no new primitive.
- **Verified:** gate 82/82; `bun turbo test:e2e` 58/58 (two earlier full runs each had one unrelated flake under load: `memory.spec` "nothing is saved from a shared chat", `workspace.spec` per-hunk review; both pass alone and on rerun). Screenshots: `/private/tmp/claude-501/101-screens/`.
- **Left:** web search isn't wired into runs on main (078), so the e2e adds citations to the history the browser loads; when 078 lands, the fixture site already answers SearXNG queries. CSP: `apps/web` sets none today, so nothing to change; image responses carry `default-src 'none'; sandbox`.
