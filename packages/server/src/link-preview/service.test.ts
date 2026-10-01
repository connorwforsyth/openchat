import { err, ok } from "@workspace/shared/result";
import { describe, expect, it, vi } from "vitest";

import type { Fetched, FetchPolicy } from "./safe-fetch";
import {
  createLinkPreviewService,
  FAILURE_TTL_MS,
  HTML_POLICY,
  PREVIEW_TTL_MS,
  type PreviewFetch,
} from "./service";
import { createImageSigner, imageSigningKey } from "./signing";

// The preview service over a fake fetcher (the real one is tested in
// safe-fetch.test.ts): caching, signed image addresses, and the image half
// refusing anything a preview didn't sign.

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

const html = (head: string): Fetched => ({
  body: new TextEncoder().encode(`<html><head>${head}</head></html>`),
  charset: "utf-8",
  contentType: "text/html",
  finalUrl: new URL("https://news.example.test/final"),
  truncated: false,
});

const image = (body: Uint8Array<ArrayBuffer>): Fetched => ({
  body,
  charset: null,
  contentType: "image/png",
  finalUrl: new URL("https://cdn.example.test/hero.png"),
  truncated: false,
});

const setup = (
  respond: (url: string, policy: FetchPolicy) => Fetched | null
) => {
  let now = new Date("2026-10-01T09:00:00Z");
  const fetch = vi.fn<PreviewFetch>((url, policy) => {
    const found = respond(url, policy);
    return Promise.resolve(
      found ? ok(found) : err({ status: 404, type: "http_status" as const })
    );
  });
  const signer = createImageSigner(imageSigningKey("secret"), {
    now: () => now,
  });
  const service = createLinkPreviewService({ fetch, now: () => now, signer });
  return {
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    fetch,
    service,
    signer,
  };
};

const IMAGE_PATH = /^\/api\/link-preview\/image\?src=/;

const srcOf = (path: string | undefined) =>
  decodeURIComponent(
    new URL(path ?? "", "http://x").searchParams.get("src") ?? ""
  );

describe("link preview service", () => {
  it("previews a page with image and icon on our own signed route", async () => {
    const { fetch, service, signer } = setup(() =>
      html(`<title>Hello</title>
        <meta property="og:image" content="https://cdn.example.test/hero.png">
        <link rel="icon" href="/icon.png" sizes="32x32">`)
    );
    const preview = await service.preview("https://news.example.test/a");
    expect(preview).toMatchObject({
      fetchedAt: "2026-10-01T09:00:00.000Z",
      finalUrl: "https://news.example.test/final",
      title: "Hello",
      url: "https://news.example.test/a",
    });
    expect(preview?.image?.url).toMatch(IMAGE_PATH);
    expect(preview?.icon).toMatch(IMAGE_PATH);
    expect(signer.verify(srcOf(preview?.image?.url))).toBe(
      "https://cdn.example.test/hero.png"
    );
    expect(signer.verify(srcOf(preview?.icon))).toBe(
      "https://news.example.test/icon.png"
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://news.example.test/a",
      HTML_POLICY
    );
  });

  it("caches a preview for 24 hours", async () => {
    const { advance, fetch, service } = setup(() => html("<title>A</title>"));
    await service.preview("https://a.example.test/");
    advance(PREVIEW_TTL_MS - 1);
    await service.preview("https://a.example.test/");
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    await service.preview("https://a.example.test/");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches a failure for an hour", async () => {
    const { advance, fetch, service } = setup(() => null);
    expect(await service.preview("https://dead.example.test/")).toBeNull();
    advance(FAILURE_TTL_MS - 1);
    expect(await service.preview("https://dead.example.test/")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    await service.preview("https://dead.example.test/");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fetches once for concurrent asks", async () => {
    const { fetch, service } = setup(() => html("<title>A</title>"));
    await Promise.all(
      Array.from({ length: 5 }, () =>
        service.preview("https://a.example.test/")
      )
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serves a signed image by its bytes, and caches it by hash", async () => {
    const { fetch, service, signer } = setup(() => image(PNG));
    const src = signer.sign("https://cdn.example.test/hero.png");
    const first = await service.image(src);
    expect(first?.contentType).toBe("image/png");
    expect(
      await service.image(signer.sign("https://cdn.example.test/hero.png"))
    ).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an unsigned or forged src without fetching", async () => {
    const { fetch, service } = setup(() => image(PNG));
    const other = createImageSigner(imageSigningKey("another secret"));
    const images = await Promise.all(
      [
        "https://cdn.example.test/hero.png",
        "http://169.254.169.254/latest/meta-data/",
        other.sign("https://cdn.example.test/hero.png"),
        "",
      ].map((src) => service.image(src))
    );
    expect(images).toEqual([null, null, null, null]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses bytes that aren't a raster image, whatever the label", async () => {
    const { service, signer } = setup(() =>
      image(new TextEncoder().encode("<svg onload='alert(1)'/>"))
    );
    expect(
      await service.image(signer.sign("https://cdn.example.test/x.png"))
    ).toBeNull();
  });
});
