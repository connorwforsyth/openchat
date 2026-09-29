import { call } from "@orpc/server";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { createTestDb, seedUser, type TestDb } from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSandboxRouter,
  disabledSandboxApi,
  fileEtag,
  type SandboxApi,
} from "./sandbox";

// The workspace file routes (055) before the sandbox package implements
// them (059): each says the feature is off, and `readFile` adds its etag.

let t: TestDb;
let db: Db;
let userId: UserId;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
  userId = (await seedUser(db)).id;
});

afterAll(() => t.close());

const as = (id: UserId) => ({
  context: { request: new Request("http://x"), session: { userId: id } },
});

const conversationId = newId("conversation");
const sandboxId = newId("sandbox");

// "abc" is the SHA-256 test vector from FIPS 180-2.
const ABC_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/** An api as the shell binds it today: none of the optional file writes. */
const withoutWrites = (
  readFile: SandboxApi["readFile"] = disabledSandboxApi.readFile
): SandboxApi => {
  const { deleteFile, importFile, writeFile, ...rest } = disabledSandboxApi;
  return { ...rest, readFile };
};

describe("fileEtag", () => {
  it("hashes the file's bytes, decoding base64 first", () => {
    expect(fileEtag("abc", "utf8")).toBe(ABC_SHA256);
    expect(fileEtag("YWJj", "base64")).toBe(ABC_SHA256);
    // UTF-8 bytes, not UTF-16 code units: "é" is c3 a9.
    expect(fileEtag("é", "utf8")).toBe(fileEtag("w6k=", "base64"));
  });
});

describe("workspace file writes", () => {
  const routes = (api: SandboxApi) => {
    const { sandbox } = createSandboxRouter({ api, db });
    return [
      call(
        sandbox.writeFile,
        { content: "hi", conversationId, path: "a.txt" },
        as(userId)
      ),
      call(
        sandbox.importFile,
        { conversationId, fileId: newId("file") },
        as(userId)
      ),
      call(sandbox.deleteFile, { conversationId, path: "a.txt" }, as(userId)),
    ];
  };

  it("say the feature is off when the shell has no sandboxes", async () => {
    await Promise.all(
      routes(disabledSandboxApi).map((result) =>
        expect(result).rejects.toMatchObject({
          code: "FEATURE_DISABLED",
          data: { feature: "sandboxes" },
          status: 403,
        })
      )
    );
  });

  it("say they aren't available yet when the bound api lacks them", async () => {
    await Promise.all(
      routes(withoutWrites()).map((result) =>
        expect(result).rejects.toMatchObject({
          code: "FEATURE_DISABLED",
          message: "Workspace file writes aren't available yet.",
          status: 403,
        })
      )
    );
  });

  it("need a session", async () => {
    const { sandbox } = createSandboxRouter({ api: disabledSandboxApi, db });
    await expect(
      call(
        sandbox.deleteFile,
        { conversationId, path: "a.txt" },
        { context: { request: new Request("http://x"), session: null } }
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("sandbox.readFile", () => {
  it("adds the etag of the bytes it read", async () => {
    const files = {
      "a.bin": { content: "YWJj", encoding: "base64" as const },
      "a.txt": { content: "abc", encoding: "utf8" as const },
    };
    const { sandbox } = createSandboxRouter({
      api: withoutWrites((_viewer, { path }) => {
        const file = files[path as keyof typeof files];
        return Promise.resolve({
          ok: true as const,
          value: { ...file, path, size: 3 },
        });
      }),
      db,
    });
    await Promise.all(
      Object.keys(files).map((path) =>
        expect(
          call(sandbox.readFile, { id: sandboxId, path }, as(userId))
        ).resolves.toMatchObject({ etag: ABC_SHA256, path, size: 3 })
      )
    );
  });

  it("passes errors through without hashing", async () => {
    const { sandbox } = createSandboxRouter({ api: disabledSandboxApi, db });
    await expect(
      call(sandbox.readFile, { id: sandboxId, path: "a.txt" }, as(userId))
    ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });
});
