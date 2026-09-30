import { createHash } from "node:crypto";

import type {
  ConversationId,
  SandboxId,
  UserId,
} from "@workspace/contract/schemas/common";
import {
  createConversation,
  type Viewer,
} from "@workspace/db/queries/conversations";
import { createFile } from "@workspace/db/queries/files";
import { upsertGrant } from "@workspace/db/queries/grants";
import { getSandboxForConversation } from "@workspace/db/queries/sandboxes";
import { loadPrincipals } from "@workspace/db/queries/teams";
import {
  createTestDb,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { createMemoryStorage } from "@workspace/server/ports/storage.memory";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJustBashFactory } from "../just-bash/provider";
import { createMemorySnapshotStore } from "../just-bash/snapshot-store";
import { createMemorySandboxFactory } from "../ports/sandbox.memory";
import type { ProviderEntry, SandboxProviders } from "../providers";
import { createDockerLikeEntry, previewUrlFor } from "../testing/docker-like";
import { STATIC_PREVIEW_PORT } from "../tools/static-preview";
import { readSandboxFile } from "./sandbox";
import {
  cleanUploadName,
  deleteWorkspaceFile,
  importWorkspaceFile,
  JUST_BASH_FILE_MAX_BYTES,
  type WorkspaceImportDeps,
  writeWorkspaceFile,
} from "./workspace-files";

// The workspace file writes (059) against a real just-bash workspace and
// PGlite: path confinement, version checks, first-use creation (including
// bringing back a workspace whose start failed), who may write, and what an
// import names its copy.

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const MIB = 1024 * 1024;

const justBash = (): ProviderEntry => ({
  factory: createJustBashFactory({ store: createMemorySnapshotStore() }),
  isolation: () => Promise.resolve(ok("simulated" as const)),
  limits: { cpu: 1, diskMb: 256, memoryMb: 256, network: false },
});

const viewerOf = async (userId: UserId): Promise<Viewer> => ({
  principals: await loadPrincipals(testDb.db, userId),
  userId,
});

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const setup = async (providers?: SandboxProviders) => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner.id,
  });
  const storage = createMemoryStorage();
  const deps: WorkspaceImportDeps = {
    db,
    defaultProvider: "just-bash",
    providers: providers ?? new Map([["just-bash", justBash()]]),
    session: await viewerOf(owner.id),
    storage,
    uploadMaxMb: 25,
  };
  return { chat, deps, owner, storage };
};

type Deps = Awaited<ReturnType<typeof setup>>["deps"];

const write = (
  deps: Deps,
  conversationId: ConversationId,
  path: string,
  content: string,
  extra: { ifMatch?: string | null } = {}
) =>
  writeWorkspaceFile(deps, {
    content,
    conversationId,
    encoding: "utf8",
    path,
    ...extra,
  });

/** What's in the chat's workspace at `path`, through the panel's own read. */
const contentOf = async (
  deps: Deps,
  conversationId: ConversationId,
  path: string
): Promise<string | null> => {
  const row = await getSandboxForConversation(deps.db, conversationId);
  if (!row) {
    return null;
  }
  const read = await readSandboxFile(deps, { id: row.id, path });
  return read.ok ? read.value.content : null;
};

const upload = async (
  { deps, owner, storage }: Awaited<ReturnType<typeof setup>>,
  name: string,
  bytes: Uint8Array,
  declaredSize = bytes.byteLength
) => {
  const storageKey = `uploads/${newId("file")}`;
  await storage.put(storageKey, bytes, { contentType: "text/plain" });
  return createFile(deps.db, {
    mediaType: "text/plain",
    name,
    ownerId: owner.id,
    purpose: "attachment",
    size: declaredSize,
    storageDriver: "local",
    storageKey,
  });
};

const invalid = expect.objectContaining({
  error: expect.objectContaining({ type: "invalid" }),
  ok: false,
});

describe("cleanUploadName", () => {
  it("strips directories and control characters", () => {
    expect(cleanUploadName("../../etc/passwd")).toBe("passwd");
    expect(cleanUploadName("C:\\Users\\me\\notes.md")).toBe("notes.md");
    expect(cleanUploadName("a\u0000b\nc.txt")).toBe("abc.txt");
    expect(cleanUploadName(" report.pdf ")).toBe("report.pdf");
  });

  it("falls back when nothing usable is left", () => {
    expect(cleanUploadName("..")).toBe("upload");
    expect(cleanUploadName("dir/")).toBe("upload");
    expect(cleanUploadName("\u0007")).toBe("upload");
  });

  it("caps the name at 255 bytes, keeping the extension", () => {
    const long = cleanUploadName(`${"é".repeat(300)}.md`);
    expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(255);
    expect(long.endsWith(".md")).toBe(true);
  });
});

describe("writeWorkspaceFile", () => {
  it("creates the workspace on first use and returns the new version", async () => {
    const { chat, deps } = await setup();
    expect(await getSandboxForConversation(deps.db, chat.id)).toBeNull();

    const written = await write(deps, chat.id, "src/a.txt", "abc");
    expect(written).toEqual(
      ok({ etag: sha256("abc"), path: "/work/src/a.txt", size: 3 })
    );
    expect(await getSandboxForConversation(deps.db, chat.id)).toMatchObject({
      provider: "just-bash",
      state: "ready",
    });
    expect(await contentOf(deps, chat.id, "src/a.txt")).toBe("abc");
  });

  it("writes base64 as bytes", async () => {
    const { chat, deps } = await setup();
    expect(
      await writeWorkspaceFile(deps, {
        content: "YWJj",
        conversationId: chat.id,
        encoding: "base64",
        path: "a.bin",
      })
    ).toEqual(ok({ etag: sha256("abc"), path: "/work/a.bin", size: 3 }));
  });

  it.each(["../escape.txt", "/etc/passwd", "/tmp/x", "a\0b"])(
    "refuses %j without creating a workspace",
    async (path) => {
      const { chat, deps } = await setup();
      expect(await write(deps, chat.id, path, "x")).toMatchObject(invalid);
      expect(await getSandboxForConversation(deps.db, chat.id)).toBeNull();
    }
  );

  it("only creates with ifMatch null", async () => {
    const { chat, deps } = await setup();
    expect(
      (await write(deps, chat.id, "a.txt", "one", { ifMatch: null })).ok
    ).toBe(true);
    expect(
      await write(deps, chat.id, "a.txt", "two", { ifMatch: null })
    ).toEqual(err({ type: "already_exists" }));
    expect(await contentOf(deps, chat.id, "a.txt")).toBe("one");
  });

  it("only replaces the version it was given", async () => {
    const { chat, deps } = await setup();
    const first = await write(deps, chat.id, "a.txt", "one");
    if (!first.ok) {
      throw new Error("write failed");
    }
    // Someone (the agent, another tab) saves in between.
    await write(deps, chat.id, "a.txt", "theirs");

    expect(
      await write(deps, chat.id, "a.txt", "mine", { ifMatch: first.value.etag })
    ).toEqual(err({ reason: "version_mismatch", type: "conflict" }));
    expect(await contentOf(deps, chat.id, "a.txt")).toBe("theirs");

    const saved = await write(deps, chat.id, "a.txt", "mine", {
      ifMatch: sha256("theirs"),
    });
    expect(saved).toEqual(
      ok({ etag: sha256("mine"), path: "/work/a.txt", size: 4 })
    );
  });

  it("calls a file gone since it was read a version mismatch", async () => {
    const { chat, deps } = await setup();
    await write(deps, chat.id, "a.txt", "one");
    await deleteWorkspaceFile(deps, {
      conversationId: chat.id,
      path: "a.txt",
      recursive: false,
    });
    expect(
      await write(deps, chat.id, "a.txt", "two", { ifMatch: sha256("one") })
    ).toEqual(err({ reason: "version_mismatch", type: "conflict" }));
  });

  it("overwrites without ifMatch, but never a directory", async () => {
    const { chat, deps } = await setup();
    await write(deps, chat.id, "a.txt", "one");
    expect((await write(deps, chat.id, "a.txt", "two")).ok).toBe(true);
    expect(await contentOf(deps, chat.id, "a.txt")).toBe("two");

    await write(deps, chat.id, "dir/inner.txt", "x");
    expect(await write(deps, chat.id, "dir", "x")).toMatchObject(invalid);
  });

  it("brings back a workspace whose start failed", async () => {
    const inner = justBash();
    let failures = 1;
    const flaky: ProviderEntry = {
      ...inner,
      factory: {
        ...inner.factory,
        create: (spec) => {
          if (failures > 0) {
            failures -= 1;
            return Promise.resolve(
              err({ message: "no room", type: "unavailable" as const })
            );
          }
          return inner.factory.create(spec);
        },
      },
    };
    const { chat, deps } = await setup(new Map([["just-bash", flaky]]));

    const first = await write(deps, chat.id, "a.txt", "one");
    expect(first).toMatchObject({
      error: { type: "unavailable" },
      ok: false,
    });
    const failed = await getSandboxForConversation(deps.db, chat.id);
    expect(failed?.state).toBe("failed");

    expect((await write(deps, chat.id, "a.txt", "one")).ok).toBe(true);
    expect(await getSandboxForConversation(deps.db, chat.id)).toMatchObject({
      id: failed?.id,
      state: "ready",
    });
    expect(await contentOf(deps, chat.id, "a.txt")).toBe("one");
  });

  it("lets editors write and refuses viewers and strangers", async () => {
    const { chat, deps, owner } = await setup();
    const grant = async (permission: "editor" | "viewer") => {
      const user = await seedUser(testDb.db);
      await upsertGrant(testDb.db, {
        grantedBy: owner.id,
        permission,
        principal: { id: user.id, type: "user" },
        resource: { resourceId: chat.id, resourceType: "conversation" },
      });
      return { ...deps, session: await viewerOf(user.id) };
    };
    const asViewer = await grant("viewer");
    const asEditor = await grant("editor");
    const asStranger = {
      ...deps,
      session: await viewerOf((await seedUser(testDb.db)).id),
    };

    expect(await write(asViewer, chat.id, "a.txt", "x")).toEqual(
      err({ type: "forbidden" })
    );
    // Refused before anything starts.
    expect(await getSandboxForConversation(deps.db, chat.id)).toBeNull();
    expect(await write(asStranger, chat.id, "a.txt", "x")).toEqual(
      err({ type: "not_found" })
    );
    expect(
      await deleteWorkspaceFile(asViewer, {
        conversationId: chat.id,
        path: "a.txt",
        recursive: false,
      })
    ).toEqual(err({ type: "forbidden" }));

    expect((await write(asEditor, chat.id, "a.txt", "x")).ok).toBe(true);
    const file = await upload(
      { chat, deps, owner, storage: deps.storage },
      "b.txt",
      new TextEncoder().encode("b")
    );
    expect(
      await importWorkspaceFile(asViewer, {
        conversationId: chat.id,
        fileId: file.id,
      })
    ).toEqual(err({ type: "forbidden" }));
  });

  it("says the feature is off without providers", async () => {
    const { chat, deps } = await setup(new Map());
    expect(await write(deps, chat.id, "a.txt", "x")).toEqual(
      err({ type: "feature_disabled" })
    );
  });

  it("holds just-bash to 50 MB a workspace", async () => {
    // The in-memory fake stands in (it reports itself as just-bash): the
    // real one saves the whole workspace after every write, which makes
    // filling 50 MB slow for no extra coverage.
    const { chat, deps } = await setup(
      new Map([
        [
          "just-bash",
          {
            ...justBash(),
            factory: createMemorySandboxFactory(),
          },
        ],
      ])
    );
    const big = "x".repeat(4 * MIB);
    // Twelve 4 MB files is 48 MB; replacing one keeps it there.
    for (let i = 0; i < 12; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: one workspace, filled in order.
      expect((await write(deps, chat.id, `f${i}.txt`, big)).ok).toBe(true);
    }
    expect((await write(deps, chat.id, "f0.txt", big)).ok).toBe(true);
    const full = await write(deps, chat.id, "f12.txt", big);
    expect(full).toMatchObject(invalid);
    expect(!full.ok && full.error).toMatchObject({
      message: expect.stringContaining("50 MB"),
    });
  });
});

describe("importWorkspaceFile", () => {
  it("copies an upload under its cleaned name, beside what's there", async () => {
    const context = await setup();
    const { chat, deps } = context;
    const file = await upload(
      context,
      "../../notes.md",
      new TextEncoder().encode("# hi")
    );
    const again = () =>
      importWorkspaceFile(deps, { conversationId: chat.id, fileId: file.id });

    expect(await again()).toEqual(
      ok({ etag: sha256("# hi"), path: "/work/notes.md", size: 4 })
    );
    expect(await again()).toMatchObject({
      ok: true,
      value: { path: "/work/notes (2).md" },
    });
    expect(await again()).toMatchObject({
      ok: true,
      value: { path: "/work/notes (3).md" },
    });
    expect(await contentOf(deps, chat.id, "notes (3).md")).toBe("# hi");
  });

  it("goes to a given path, de-duplicated too", async () => {
    const context = await setup();
    const { chat, deps } = context;
    await write(deps, chat.id, "docs/readme", "old");
    const file = await upload(
      context,
      "x.txt",
      new TextEncoder().encode("new")
    );
    expect(
      await importWorkspaceFile(deps, {
        conversationId: chat.id,
        fileId: file.id,
        path: "docs/readme",
      })
    ).toMatchObject({ ok: true, value: { path: "/work/docs/readme (2)" } });
    expect(await contentOf(deps, chat.id, "docs/readme")).toBe("old");
    expect(
      await importWorkspaceFile(deps, {
        conversationId: chat.id,
        fileId: file.id,
        path: "../outside.txt",
      })
    ).toMatchObject(invalid);
  });

  it("refuses an upload the session can't read", async () => {
    const context = await setup();
    const other = await setup();
    const theirs = await upload(other, "secret.txt", new Uint8Array([1]));
    expect(
      await importWorkspaceFile(context.deps, {
        conversationId: context.chat.id,
        fileId: theirs.id,
      })
    ).toEqual(err({ type: "not_found" }));
    expect(
      await getSandboxForConversation(context.deps.db, context.chat.id)
    ).toBeNull();
  });

  it("caps imports by uploadMaxMb and the workspace's file size", async () => {
    const context = await setup();
    const { chat, deps } = context;
    const bytes = new Uint8Array(2 * MIB);
    const file = await upload(context, "big.bin", bytes);
    expect(
      await importWorkspaceFile(
        { ...deps, uploadMaxMb: 1 },
        { conversationId: chat.id, fileId: file.id }
      )
    ).toMatchObject({
      error: { message: expect.stringContaining("1 MB"), type: "invalid" },
      ok: false,
    });

    // Past just-bash's cap even though the upload limit allows it.
    const huge = await upload(
      context,
      "huge.bin",
      new Uint8Array(JUST_BASH_FILE_MAX_BYTES + 1)
    );
    expect(
      await importWorkspaceFile(deps, {
        conversationId: chat.id,
        fileId: huge.id,
      })
    ).toMatchObject({
      error: { message: expect.stringContaining("10 MB"), type: "invalid" },
      ok: false,
    });

    // A row that under-declares its size is held to the bytes.
    const liar = await upload(context, "liar.bin", bytes, 10);
    expect(
      await importWorkspaceFile(
        { ...deps, uploadMaxMb: 1 },
        { conversationId: chat.id, fileId: liar.id }
      )
    ).toMatchObject(invalid);
  });

  it("says so when the upload's bytes aren't there", async () => {
    const context = await setup();
    const file = await createFile(context.deps.db, {
      mediaType: "text/plain",
      name: "gone.txt",
      ownerId: context.owner.id,
      purpose: "attachment",
      size: 1,
      storageDriver: "local",
      storageKey: `uploads/${newId("file")}`,
    });
    expect(
      await importWorkspaceFile(context.deps, {
        conversationId: context.chat.id,
        fileId: file.id,
      })
    ).toMatchObject(invalid);
  });
});

describe("deleteWorkspaceFile", () => {
  const remove = (
    deps: Deps,
    conversationId: ConversationId,
    path: string,
    recursive = false
  ) => deleteWorkspaceFile(deps, { conversationId, path, recursive });

  it("deletes a file, including one whose name looks like an option", async () => {
    const { chat, deps } = await setup();
    await write(deps, chat.id, "a.txt", "x");
    await write(deps, chat.id, "-rf", "x");
    await write(deps, chat.id, "it's.txt", "x");
    for (const path of ["a.txt", "-rf", "it's.txt"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one workspace, in order.
      expect(await remove(deps, chat.id, path)).toEqual(ok(undefined));
      expect(await contentOf(deps, chat.id, path)).toBeNull();
    }
  });

  it("needs recursive for a directory with anything in it", async () => {
    const { chat, deps } = await setup();
    await write(deps, chat.id, "dir/a.txt", "x");
    await write(deps, chat.id, "dir/sub/b.txt", "y");

    expect(await remove(deps, chat.id, "dir")).toEqual(
      err({ reason: "not_empty", type: "conflict" })
    );
    expect(await contentOf(deps, chat.id, "dir/a.txt")).toBe("x");

    expect(await remove(deps, chat.id, "dir", true)).toEqual(ok(undefined));
    expect(await contentOf(deps, chat.id, "dir/sub/b.txt")).toBeNull();
  });

  it("deletes an empty directory without recursive", async () => {
    const { chat, deps } = await setup();
    await write(deps, chat.id, "dir/a.txt", "x");
    await remove(deps, chat.id, "dir/a.txt");
    expect(await remove(deps, chat.id, "dir")).toEqual(ok(undefined));
    expect(await write(deps, chat.id, "dir", "now a file")).toMatchObject({
      ok: true,
    });
  });

  it("refuses paths outside the workspace and the workspace itself", async () => {
    const { chat, deps } = await setup();
    await write(deps, chat.id, "a.txt", "x");
    for (const path of ["../", "/", "/work", ".", "/etc/passwd", "a\0"]) {
      // biome-ignore lint/performance/noAwaitInLoops: in order, against one workspace.
      expect(await remove(deps, chat.id, path, true)).toMatchObject(invalid);
    }
    expect(await contentOf(deps, chat.id, "a.txt")).toBe("x");
  });

  it("says a missing file is missing, after creating the workspace", async () => {
    const { chat, deps } = await setup();
    expect(await remove(deps, chat.id, "nope.txt")).toMatchObject(invalid);
    expect(await getSandboxForConversation(deps.db, chat.id)).toMatchObject({
      state: "ready",
    });
  });
});

describe("static pages (067)", () => {
  const dockerSetup = async () => {
    const docker = createDockerLikeEntry();
    const context = await setup(
      new Map([["docker", docker.entry]]) as SandboxProviders
    );
    const logged: string[] = [];
    const deps: Deps = {
      ...context.deps,
      defaultProvider: "docker",
      log: (message) => logged.push(message),
    };
    return { ...context, deps, host: docker.host, logged };
  };

  const previewsOf = async (deps: Deps, conversationId: ConversationId) =>
    (await getSandboxForConversation(deps.db, conversationId))?.previews;

  it("previews a page someone saves or imports", async () => {
    const context = await dockerSetup();
    const { chat, deps, host } = context;
    expect((await write(deps, chat.id, "notes.md", "# hi")).ok).toBe(true);
    expect(await previewsOf(deps, chat.id)).toEqual([]);

    expect(
      (await write(deps, chat.id, "site/index.html", "<h1>hi</h1>")).ok
    ).toBe(true);
    const row = await getSandboxForConversation(deps.db, chat.id);
    expect(row?.previews).toEqual([
      {
        port: STATIC_PREVIEW_PORT,
        url: previewUrlFor(row?.id as SandboxId, STATIC_PREVIEW_PORT),
      },
    ]);

    const file = await upload(
      context,
      "page.html",
      new TextEncoder().encode("<p>imported</p>")
    );
    expect(
      (
        await importWorkspaceFile(deps, {
          conversationId: chat.id,
          fileId: file.id,
        })
      ).ok
    ).toBe(true);
    expect(
      host.commands.filter((command) => command.startsWith("nohup node"))
    ).toHaveLength(1);
  });

  it("saves the page even when its preview fails, and logs why", async () => {
    const { chat, deps, host, logged } = await dockerSetup();
    host.failExpose = true;
    const saved = await write(deps, chat.id, "index.html", "<h1>hi</h1>");
    expect(saved.ok && saved.value.path).toBe("/work/index.html");
    expect(await previewsOf(deps, chat.id)).toEqual([]);
    expect(logged).toEqual([expect.stringContaining("static preview")]);
  });

  it("does nothing more on just-bash, which has no ports", async () => {
    const { chat, deps } = await setup();
    expect((await write(deps, chat.id, "index.html", "<h1>hi</h1>")).ok).toBe(
      true
    );
    expect(await previewsOf(deps, chat.id)).toEqual([]);
  });
});
