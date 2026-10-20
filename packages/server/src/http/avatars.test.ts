import type { UserId } from "@workspace/contract/schemas/common";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "../ports/storage.memory";
import { avatarStoreFor, mountAvatarRoutes } from "./avatars";

const ORIGIN = "http://localhost:3005";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

const setup = () => {
  const storage = createMemoryStorage();
  const app = new Hono();
  mountAvatarRoutes(app, {
    resolveSession: (request) =>
      Promise.resolve(
        request.headers.has("x-user") ? { userId: "u" as UserId } : null
      ),
    storage,
  });
  return { app, avatars: avatarStoreFor(storage, ORIGIN), storage };
};

describe("avatars (186)", () => {
  it("stores, finds and serves a photo to signed-in people", async () => {
    const { app, avatars } = setup();
    expect(await avatars.find("microsoft/a/b")).toBeUndefined();
    const put = await avatars.put("microsoft/a/b", JPEG, "image/jpeg");
    expect(put).toEqual({
      ok: true,
      value: `${ORIGIN}/api/avatars/microsoft/a/b`,
    });
    expect(await avatars.find("microsoft/a/b")).toBe(
      `${ORIGIN}/api/avatars/microsoft/a/b`
    );

    const served = await app.request("/api/avatars/microsoft/a/b", {
      headers: { "x-user": "1" },
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
  });

  it("answers 401 signed out and 404 for anything else", async () => {
    const { app, avatars, storage } = setup();
    await avatars.put("microsoft/a/b", JPEG, "image/jpeg");
    await storage.put("avatars/x", new Uint8Array([60]), {
      contentType: "text/html",
    });
    expect((await app.request("/api/avatars/microsoft/a/b")).status).toBe(401);
    const signedIn = { headers: { "x-user": "1" } };
    expect((await app.request("/api/avatars/missing", signedIn)).status).toBe(
      404
    );
    expect((await app.request("/api/avatars/x", signedIn)).status).toBe(404);
  });
});
