import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "./storage.memory";

const text = (value: string) => new TextEncoder().encode(value);
const clock = () => new Date("2026-09-26T09:00:00.000Z");

const readText = async (body: ReadableStream<Uint8Array>) =>
  new TextDecoder().decode(await new Response(body).arrayBuffer());

describe("memory Storage", () => {
  it("puts, stats and gets bytes back", async () => {
    const storage = createMemoryStorage({ now: clock });
    const put = await storage.put("files/a.txt", text("hello"), {
      contentType: "text/plain",
    });
    expect(put).toMatchObject({
      ok: true,
      value: { key: "files/a.txt", size: 5 },
    });
    const got = await storage.get("files/a.txt");
    expect(got.ok && (await readText(got.value.body))).toBe("hello");
    expect(await storage.stat("files/a.txt")).toMatchObject({
      value: { contentType: "text/plain" },
    });
  });

  it("accepts a stream body and changes the etag on overwrite", async () => {
    const storage = createMemoryStorage();
    const first = await storage.put("a", text("1"), {
      contentType: "text/plain",
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(text("he"));
        controller.enqueue(text("llo"));
        controller.close();
      },
    });
    const second = await storage.put("a", stream, {
      contentType: "text/plain",
    });
    expect(second.ok && second.value.size).toBe(5);
    expect(
      first.ok && second.ok && first.value.etag !== second.value.etag
    ).toBe(true);
  });

  it("rejects keys that could escape the root", async () => {
    const storage = createMemoryStorage();
    const keys = ["/abs", "../up", "a/../b", "a/./b", "sp ace"];
    const results = await Promise.all(
      keys.map((key) =>
        storage.put(key, text("x"), { contentType: "text/plain" })
      )
    );
    expect(results).toEqual(
      keys.map((key) => ({ error: { key, type: "invalid_key" }, ok: false }))
    );
  });

  it("deletes idempotently and reports missing keys", async () => {
    const storage = createMemoryStorage();
    await storage.put("a", text("x"), { contentType: "text/plain" });
    expect((await storage.delete("a")).ok).toBe(true);
    expect((await storage.delete("a")).ok).toBe(true);
    expect(await storage.get("a")).toEqual({
      error: { key: "a", type: "not_found" },
      ok: false,
    });
  });

  it("signs expiring URLs, and GET URLs only for existing objects", async () => {
    const storage = createMemoryStorage({ now: clock });
    await storage.put("a.pdf", text("%PDF"), {
      contentType: "application/pdf",
    });
    const url = await storage.signedUrl("a.pdf", {
      expiresInSeconds: 60,
      method: "GET",
    });
    expect(url).toMatchObject({
      ok: true,
      value: { expiresAt: "2026-09-26T09:01:00.000Z" },
    });
    expect(url.ok && url.value.url.startsWith("memory://storage/a.pdf?")).toBe(
      true
    );
    expect(
      (
        await storage.signedUrl("new.pdf", {
          expiresInSeconds: 60,
          method: "PUT",
        })
      ).ok
    ).toBe(true);
    expect(
      (
        await storage.signedUrl("missing.pdf", {
          expiresInSeconds: 60,
          method: "GET",
        })
      ).ok
    ).toBe(false);
  });
});
