import type { UserId } from "@workspace/contract/schemas/common";
import { linkPreviewSchema } from "@workspace/contract/schemas/link-preview";
import { err, ok } from "@workspace/shared/result";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { createRateLimiter } from "./rate-limit";
import { createLinkPreviewRouter } from "./router";
import type { Fetched } from "./safe-fetch";
import { createLinkPreviewService, type PreviewFetch } from "./service";
import { createImageSigner, imageSigningKey } from "./signing";

// The `linkPreviews` procedures over HTTP, in-process through Hono, with a
// fake fetcher behind the service: the contract round trip, sign-in, the
// feature flag, rate limits, and the image route refusing unsigned sources.

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

const PAGE = `<html><head>
  <meta property="og:title" content="Rivers are getting warmer">
  <meta property="og:description" content="A study of 300 rivers.">
  <meta property="og:site_name" content="Example News">
  <meta property="og:image" content="https://cdn.example.test/hero.png">
  <link rel="icon" href="/icon.png" sizes="32x32">
</head></html>`;

const fetched = (url: string): Fetched | null => {
  if (url === "https://news.example.test/rivers") {
    return {
      body: new TextEncoder().encode(PAGE),
      charset: "utf-8",
      contentType: "text/html",
      finalUrl: new URL(url),
      truncated: false,
    };
  }
  if (url.startsWith("https://cdn.example.test/")) {
    return {
      body: new Uint8Array(PNG),
      charset: null,
      contentType: "image/png",
      finalUrl: new URL(url),
      truncated: false,
    };
  }
  return null;
};

const setup = ({
  enabled = true,
  previewsPerMinute = 100,
}: {
  enabled?: boolean;
  previewsPerMinute?: number;
} = {}) => {
  const fetch = vi.fn<PreviewFetch>((url) => {
    const found = fetched(url);
    return Promise.resolve(
      found ? ok(found) : err({ status: 404, type: "http_status" as const })
    );
  });
  const signer = createImageSigner(imageSigningKey("secret"));
  const app = createApp({
    resolveSession: (request) => {
      const user = request.headers.get("x-test-user");
      return Promise.resolve(user ? { userId: user as UserId } : null);
    },
    routers: createLinkPreviewRouter({
      enabled,
      limits: {
        images: createRateLimiter({ limit: 100, windowMs: 60_000 }),
        previews: createRateLimiter({
          limit: previewsPerMinute,
          windowMs: 60_000,
        }),
      },
      service: createLinkPreviewService({ fetch, signer }),
    }),
    services: null,
  });
  const get = (path: string, user: string | null = "user-ada") =>
    app.request(path, { headers: user ? { "x-test-user": user } : {} });
  return { fetch, get, signer };
};

const INLINE = /^inline/;

const previewPath = (url: string) =>
  `/api/link-preview?url=${encodeURIComponent(url)}`;

describe("GET /api/link-preview", () => {
  it("round-trips a preview through the contract", async () => {
    const { get } = setup();
    const response = await get(previewPath("https://news.example.test/rivers"));
    expect(response.status).toBe(200);
    const preview = linkPreviewSchema.parse(await response.json());
    expect(preview).toMatchObject({
      description: "A study of 300 rivers.",
      finalUrl: "https://news.example.test/rivers",
      siteName: "Example News",
      title: "Rivers are getting warmer",
      url: "https://news.example.test/rivers",
    });
    expect(preview.image?.url.startsWith("/api/link-preview/image?src=")).toBe(
      true
    );
    expect(preview.icon?.startsWith("/api/link-preview/image?src=")).toBe(true);
  });

  it("needs a signed-in user", async () => {
    const { fetch, get } = setup();
    const response = await get(
      previewPath("https://news.example.test/rivers"),
      null
    );
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses schemes other than http(s) before fetching", async () => {
    const { fetch, get } = setup();
    const responses = await Promise.all(
      ["file:///etc/passwd", "javascript:alert(1)"].map((url) =>
        get(previewPath(url))
      )
    );
    expect(responses.map(({ status }) => status)).toEqual([400, 400]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND when there's no preview", async () => {
    const { get } = setup();
    const response = await get(previewPath("https://gone.example.test/"));
    expect(response.status).toBe(404);
  });

  it("fetches nothing when the feature is off", async () => {
    const { fetch, get } = setup({ enabled: false });
    const response = await get(previewPath("https://news.example.test/rivers"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "FEATURE_DISABLED",
      data: { feature: "linkPreviews" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rate-limits per user", async () => {
    const { get } = setup({ previewsPerMinute: 2 });
    const url = previewPath("https://news.example.test/rivers");
    expect((await get(url)).status).toBe(200);
    expect((await get(url)).status).toBe(200);
    const limited = await get(url);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      code: "RATE_LIMITED",
      data: { retryAfterSeconds: expect.any(Number) },
    });
    expect((await get(url, "user-grace")).status).toBe(200);
  });
});

describe("GET /api/link-preview/image", () => {
  it("serves a preview's image as inert, sniffed bytes", async () => {
    const { get } = setup();
    const preview = linkPreviewSchema.parse(
      await (await get(previewPath("https://news.example.test/rivers"))).json()
    );
    const response = await get(preview.image?.url ?? "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox"
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin"
    );
    expect(response.headers.get("content-disposition")).toMatch(INLINE);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("refuses an unsigned or forged src, so it isn't an open proxy", async () => {
    const { fetch, get } = setup();
    const forger = createImageSigner(imageSigningKey("not the secret"));
    const responses = await Promise.all(
      [
        "https://cdn.example.test/hero.png",
        "http://169.254.169.254/latest/meta-data/",
        forger.sign("https://cdn.example.test/hero.png"),
      ].map((src) =>
        get(`/api/link-preview/image?src=${encodeURIComponent(src)}`)
      )
    );
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    const { get, signer } = setup();
    const src = signer.sign("https://cdn.example.test/hero.png");
    const response = await get(
      `/api/link-preview/image?src=${encodeURIComponent(src)}`,
      null
    );
    expect(response.status).toBe(401);
  });
});
