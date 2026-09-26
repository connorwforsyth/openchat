import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appConfigSchema } from "@workspace/config/schema";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Storage } from "../ports/storage";
import { createStorage } from "./from-config";
import { createLocalStorage, verifyLocalSignature } from "./local";
import { createS3Storage } from "./s3";

const text = async (body: ReadableStream<Uint8Array>) =>
  new Response(body).text();
const bytes = (value: string) => new TextEncoder().encode(value);
const clock = () => new Date("2026-09-27T10:00:00.000Z");
const QUOTED_SHA256 = /^"[0-9a-f]{64}"$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** The Storage contract, run against each adapter: what a round trip observes. */
const roundTrip = async (storage: Storage) => {
  const put = await storage.put("uploads/u1/a.txt", bytes("hello"), {
    contentType: "text/plain",
  });
  const got = await storage.get("uploads/u1/a.txt");
  return {
    body: got.ok ? await text(got.value.body) : null,
    deleted: await storage.delete("uploads/u1/a.txt"),
    // Deleting again is fine; escaping the root never is.
    deletedAgain: (await storage.delete("uploads/u1/a.txt")).ok,
    escape: await storage.get("../etc/passwd"),
    put,
    statAfter: await storage.stat("uploads/u1/a.txt"),
  };
};

const ROUND_TRIP = {
  body: "hello",
  deleted: { ok: true, value: undefined },
  deletedAgain: true,
  escape: { error: { type: "invalid_key" } },
  put: {
    ok: true,
    value: { contentType: "text/plain", key: "uploads/u1/a.txt", size: 5 },
  },
  statAfter: { error: { type: "not_found" } },
};

describe("local storage", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "storage-test-"));
  });
  afterAll(() => rm(root, { force: true, recursive: true }));

  const local = () =>
    createLocalStorage({
      baseUrl: "https://chat.example.test/api/storage/",
      now: clock,
      root,
      signingSecret: "test-signing-secret",
    });

  it("stores, reads, stats and deletes", async () => {
    const storage = local();
    await storage.put("uploads/u1/b.txt", bytes("hello"), {
      contentType: "text/plain",
    });
    expect(await storage.stat("uploads/u1/b.txt")).toMatchObject({
      ok: true,
      value: { contentType: "text/plain", size: 5 },
    });
    expect(await roundTrip(storage)).toMatchObject(ROUND_TRIP);
  });

  it("accepts a stream and records a content hash as the etag", async () => {
    const storage = local();
    const stream = new Response("streamed body").body;
    if (!stream) {
      throw new Error("no body");
    }
    const put = await storage.put("s/stream.bin", stream, {
      contentType: "application/octet-stream",
    });
    expect(put.ok && put.value.size).toBe(13);
    expect(put.ok && put.value.etag).toMatch(QUOTED_SHA256);
    const again = await storage.put("s/stream.bin", bytes("streamed body"), {
      contentType: "application/octet-stream",
    });
    expect(again.ok && again.value.etag).toBe(put.ok && put.value.etag);
  });

  it("signs URLs to its own route and verifies them", async () => {
    const storage = local();
    await storage.put("docs/report_1.pdf", bytes("%PDF"), {
      contentType: "application/pdf",
    });
    const signed = await storage.signedUrl("docs/report_1.pdf", {
      expiresInSeconds: 300,
      method: "GET",
    });
    if (!signed.ok) {
      throw new Error("not signed");
    }
    expect(signed.value.expiresAt).toBe("2026-09-27T10:05:00.000Z");
    const url = new URL(signed.value.url);
    expect(url.pathname).toBe("/api/storage/docs/report_1.pdf");
    const request = {
      contentType: url.searchParams.get("contentType") ?? "",
      expires: url.searchParams.get("expires") ?? "",
      key: "docs/report_1.pdf",
      method: "GET" as const,
      signature: url.searchParams.get("signature") ?? "",
    };
    expect(
      verifyLocalSignature(request, "test-signing-secret", clock()).ok
    ).toBe(true);
    expect(
      verifyLocalSignature(
        { ...request, key: "docs/other.pdf" },
        "test-signing-secret",
        clock()
      )
    ).toEqual({ error: "invalid", ok: false });
    expect(
      verifyLocalSignature(
        request,
        "test-signing-secret",
        new Date("2026-09-27T11:00:00Z")
      )
    ).toEqual({ error: "expired", ok: false });
    expect(
      await storage.signedUrl("docs/missing.pdf", {
        expiresInSeconds: 60,
        method: "GET",
      })
    ).toMatchObject({ error: { type: "not_found" } });
  });
});

describe("S3 storage", () => {
  const ENDPOINT = "http://minio.test:9000";
  const objects = new Map<string, { body: string; type: string }>();
  const authorizations: string[] = [];
  const server = setupServer(
    http.all(`${ENDPOINT}/bucket/*`, async ({ request }) => {
      const key = decodeURIComponent(
        new URL(request.url).pathname.replace("/bucket/", "")
      );
      authorizations.push(request.headers.get("authorization") ?? "");
      const found = objects.get(key);
      switch (request.method) {
        case "PUT":
          objects.set(key, {
            body: await request.text(),
            type: request.headers.get("content-type") ?? "",
          });
          return new HttpResponse(null, { headers: { etag: '"abc"' } });
        case "GET":
        case "HEAD":
          return found
            ? new HttpResponse(request.method === "GET" ? found.body : null, {
                headers: {
                  "content-length": String(found.body.length),
                  "content-type": found.type,
                  etag: '"abc"',
                  "last-modified": "Sun, 27 Sep 2026 09:00:00 GMT",
                },
              })
            : new HttpResponse(null, { status: 404 });
        case "DELETE":
          objects.delete(key);
          return new HttpResponse(null, { status: 204 });
        default:
          return new HttpResponse(null, { status: 405 });
      }
    })
  );
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const s3 = () =>
    createS3Storage({
      accessKeyId: "test-access",
      bucket: "bucket",
      endpoint: ENDPOINT,
      fetch: (input, init) => globalThis.fetch(input, init),
      forcePathStyle: true,
      now: clock,
      region: "us-east-1",
      secretAccessKey: "test-secret",
    });

  it("stores, reads, stats and deletes over signed requests", async () => {
    const storage = s3();
    await storage.put("uploads/u1/b.txt", bytes("hello"), {
      contentType: "text/plain",
    });
    expect(await storage.stat("uploads/u1/b.txt")).toMatchObject({
      ok: true,
      value: { contentType: "text/plain", size: 5 },
    });
    expect(await roundTrip(storage)).toMatchObject(ROUND_TRIP);
    expect(authorizations.length).toBeGreaterThan(0);
    expect(
      authorizations.every((value) =>
        value.startsWith(
          "AWS4-HMAC-SHA256 Credential=test-access/20260927/us-east-1/s3/aws4_request"
        )
      )
    ).toBe(true);
  });

  it("presigns URLs, pinning a PUT's content type", async () => {
    const put = await s3().signedUrl("up/a.png", {
      contentType: "image/png",
      expiresInSeconds: 600,
      method: "PUT",
    });
    if (!put.ok) {
      throw new Error("not signed");
    }
    const url = new URL(put.value.url);
    expect(url.origin + url.pathname).toBe(`${ENDPOINT}/bucket/up/a.png`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-type"
    );
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(HEX_SHA256);
    expect(put.value.expiresAt).toBe("2026-09-27T10:10:00.000Z");
  });

  it("reports an unreachable store as unavailable", async () => {
    server.use(http.all(`${ENDPOINT}/bucket/*`, () => HttpResponse.error()));
    expect(await s3().stat("x")).toEqual({
      error: {
        message: "the object store couldn't be reached",
        type: "unavailable",
      },
      ok: false,
    });
  });

  it("uses virtual-hosted URLs unless path style is forced", async () => {
    const hosted = createS3Storage({
      accessKeyId: "test-access",
      bucket: "media",
      endpoint: null,
      forcePathStyle: false,
      now: clock,
      region: "eu-west-2",
      secretAccessKey: "test-secret",
    });
    const signed = await hosted.signedUrl("a/b.txt", {
      expiresInSeconds: 60,
      method: "GET",
    });
    expect(signed.ok && new URL(signed.value.url).host).toBe(
      "media.s3.eu-west-2.amazonaws.com"
    );
  });
});

describe("createStorage", () => {
  const options = { baseUrl: "http://localhost:3000/api/storage", env: {} };

  it("defaults to a local volume", () => {
    const configured = createStorage(appConfigSchema.parse({}), options);
    expect(configured).toMatchObject({ driver: "local", problem: null });
    expect(configured.signingSecret).toBeTruthy();
  });

  it("degrades S3 without credentials instead of crashing", async () => {
    const configured = createStorage(
      appConfigSchema.parse({ storage: { bucket: "b", driver: "s3" } }),
      options
    );
    expect(configured.problem).toContain("no credentials");
    expect(
      await configured.storage.put("k", bytes("x"), {
        contentType: "text/plain",
      })
    ).toMatchObject({ error: { type: "unavailable" }, ok: false });

    const fromEnv = createStorage(
      appConfigSchema.parse({
        storage: { bucket: "b", driver: "s3", region: "us-east-1" },
      }),
      {
        ...options,
        env: {
          S3_ACCESS_KEY_ID: "test-access",
          S3_SECRET_ACCESS_KEY: "test-secret",
        },
      }
    );
    expect(fromEnv).toMatchObject({ driver: "s3", problem: null });
  });
});
