import { call } from "@orpc/server";
import type { UserId } from "@workspace/contract/schemas/common";
import type {
  DeleteFileInput,
  ImportFileInput,
  WriteFileInput,
} from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import { createTestDb, seedUser, type TestDb } from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import {
  createSandboxRouter,
  disabledSandboxApi,
  fileEtag,
  type SandboxApi,
  type SandboxApiError,
} from "./sandbox";

// The workspace file routes (055): off when the bound api lacks them, and
// over HTTP with one that has them (059), where each handler error becomes
// the contract's status and conflict reason. `readFile` adds its etag.

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

describe("workspace file routes over HTTP", () => {
  const ETAG = "a".repeat(64);

  /** An api whose file writes answer `result` and record what they were asked. */
  const bound = (
    result:
      | { ok: true; value?: unknown }
      | { error: SandboxApiError; ok: false }
  ) => {
    const calls: {
      deleteFile: DeleteFileInput[];
      importFile: ImportFileInput[];
      writeFile: WriteFileInput[];
    } = { deleteFile: [], importFile: [], writeFile: [] };
    const answer = () =>
      Promise.resolve(
        result.ok
          ? {
              ok: true as const,
              value: (result.value ?? {
                etag: ETAG,
                path: "/work/a.txt",
                size: 2,
              }) as never,
            }
          : result
      );
    const api: SandboxApi = {
      ...disabledSandboxApi,
      deleteFile: (_viewer, input) => {
        calls.deleteFile.push(input);
        return answer();
      },
      importFile: (_viewer, input) => {
        calls.importFile.push(input);
        return answer();
      },
      writeFile: (_viewer, input) => {
        calls.writeFile.push(input);
        return answer();
      },
    };
    const app = createApp({
      resolveSession: () => Promise.resolve({ userId }),
      routers: createSandboxRouter({ api, db }),
      services: null,
    });
    return { app, calls };
  };

  const send = (
    app: ReturnType<typeof bound>["app"],
    method: "DELETE" | "POST",
    path: string,
    body: unknown
  ) =>
    app.request(`/api/conversations/${conversationId}/sandbox/${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    });

  it("POST …/sandbox/files writes and returns the new version", async () => {
    const { app, calls } = bound({ ok: true });
    const response = await send(app, "POST", "files", {
      content: "hi",
      ifMatch: null,
      path: "a.txt",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      etag: ETAG,
      path: "/work/a.txt",
      size: 2,
    });
    expect(calls.writeFile).toEqual([
      {
        content: "hi",
        conversationId,
        encoding: "utf8",
        ifMatch: null,
        path: "a.txt",
      },
    ]);
  });

  it.each([
    [{ type: "already_exists" }, "already_exists"],
    [{ reason: "version_mismatch", type: "conflict" }, "version_mismatch"],
  ] as const)(
    "POST …/sandbox/files answers CONFLICT %j",
    async (error, reason) => {
      const { app } = bound({ error, ok: false });
      const response = await send(app, "POST", "files", {
        content: "hi",
        ifMatch: ETAG,
        path: "a.txt",
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "CONFLICT",
        data: { reason },
      });
    }
  );

  it("POST …/sandbox/files refuses a malformed etag before the handler", async () => {
    const { app, calls } = bound({ ok: true });
    const response = await send(app, "POST", "files", {
      content: "hi",
      ifMatch: "not-an-etag",
      path: "a.txt",
    });
    expect(response.status).toBe(400);
    expect(calls.writeFile).toEqual([]);
  });

  it("POST …/sandbox/imports answers 201 with where the copy landed", async () => {
    const fileId = newId("file");
    const { app, calls } = bound({
      ok: true,
      value: { etag: ETAG, path: "/work/notes (2).md", size: 4 },
    });
    const response = await send(app, "POST", "imports", { fileId });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      etag: ETAG,
      path: "/work/notes (2).md",
      size: 4,
    });
    expect(calls.importFile).toEqual([{ conversationId, fileId }]);
  });

  it.each([
    [{ message: "too big", type: "invalid" }, 422, "VALIDATION"],
    [{ type: "not_found" }, 404, "NOT_FOUND"],
    [{ type: "forbidden" }, 403, "FORBIDDEN"],
    [{ type: "feature_disabled" }, 403, "FEATURE_DISABLED"],
  ] as const)(
    "POST …/sandbox/imports maps %j to %i",
    async (error, status, code) => {
      const { app } = bound({ error, ok: false });
      const response = await send(app, "POST", "imports", {
        fileId: newId("file"),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
    }
  );

  it("DELETE …/sandbox/files answers 204, with the path in the body", async () => {
    const { app, calls } = bound({ ok: true, value: undefined });
    const response = await send(app, "DELETE", "files", {
      path: "dir",
      recursive: true,
    });
    expect(response.status).toBe(204);
    expect(calls.deleteFile).toEqual([
      { conversationId, path: "dir", recursive: true },
    ]);

    await send(app, "DELETE", "files", { path: "a.txt" });
    expect(calls.deleteFile[1]).toEqual({
      conversationId,
      path: "a.txt",
      recursive: false,
    });
  });

  it("DELETE …/sandbox/files answers CONFLICT not_empty", async () => {
    const { app } = bound({
      error: { reason: "not_empty", type: "conflict" },
      ok: false,
    });
    const response = await send(app, "DELETE", "files", { path: "dir" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CONFLICT",
      data: { reason: "not_empty" },
    });
  });

  it("need a session over HTTP too", async () => {
    const app = createApp({
      resolveSession: () => Promise.resolve(null),
      routers: createSandboxRouter({ api: disabledSandboxApi, db }),
      services: null,
    });
    const response = await send(app, "POST", "files", {
      content: "hi",
      path: "a.txt",
    });
    expect(response.status).toBe(401);
  });
});
