import type { UserId } from "@workspace/contract/schemas/common";
import {
  createConversation,
  type Viewer,
} from "@workspace/db/queries/conversations";
import { upsertGrant } from "@workspace/db/queries/grants";
import { getSandbox } from "@workspace/db/queries/sandboxes";
import { loadPrincipals } from "@workspace/db/queries/teams";
import {
  createTestDb,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJustBashFactory } from "../just-bash/provider";
import { createMemorySnapshotStore } from "../just-bash/snapshot-store";
import { createMemorySandboxFactory } from "../ports/sandbox.memory";
import type { ProviderEntry, SandboxProviders } from "../providers";
import { STATIC_PREVIEW_PORT } from "../static-preview";
import { createDockerLikeEntry, previewUrlFor } from "../testing/docker-like";
import { createSandboxExecJobHandler, SANDBOX_EXEC_JOB } from "./exec-job";
import {
  createConversationSandbox,
  destroySandbox,
  execInSandbox,
  exposeSandboxPort,
  getConversationSandbox,
  listSandboxFiles,
  readSandboxFile,
  recordPreview,
  resetSandbox,
  type SandboxHandlerDeps,
} from "./sandbox";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const limits = { cpu: 1, diskMb: 64, memoryMb: 256, network: false };

const justBash = (): ProviderEntry => ({
  factory: createJustBashFactory({ store: createMemorySnapshotStore() }),
  isolation: () => Promise.resolve(ok("simulated" as const)),
  limits,
});

const viewerOf = async (userId: UserId): Promise<Viewer> => ({
  principals: await loadPrincipals(testDb.db, userId),
  userId,
});

const setup = async (providers?: SandboxProviders) => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner.id,
  });
  const deps: SandboxHandlerDeps = {
    db,
    defaultProvider: "just-bash",
    providers: providers ?? new Map([["just-bash", justBash()]]),
    session: await viewerOf(owner.id),
  };
  return { chat, deps, owner };
};

const must = async <T>(
  result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>
): Promise<T> => {
  const settled = await result;
  if (!settled.ok) {
    throw new Error(JSON.stringify(settled.error));
  }
  return settled.value;
};

describe("sandbox handlers", () => {
  it("creates, gets, runs and reads a chat's just-bash sandbox", async () => {
    const { chat, deps } = await setup();
    expect(
      await must(getConversationSandbox(deps, { conversationId: chat.id }))
    ).toBeNull();

    const created = await must(
      createConversationSandbox(deps, { conversationId: chat.id })
    );
    expect(created).toMatchObject({
      conversationId: chat.id,
      isolation: "simulated",
      provider: "just-bash",
      status: { state: "ready" },
    });

    const run = await must(
      execInSandbox(deps, {
        command: "ls && echo hi > a.txt && cat a.txt",
        id: created.id,
      })
    );
    expect(run).toMatchObject({ exitCode: 0, stdout: "hi\n" });
    expect(
      (
        await must(
          listSandboxFiles(deps, {
            id: created.id,
            path: ".",
            recursive: false,
          })
        )
      ).map((entry) => entry.path)
    ).toEqual(["/work/a.txt"]);
    expect(
      await must(readSandboxFile(deps, { id: created.id, path: "a.txt" }))
    ).toEqual({
      content: "hi\n",
      encoding: "utf8",
      path: "a.txt",
      size: 3,
    });
    expect(
      await must(getConversationSandbox(deps, { conversationId: chat.id }))
    ).toMatchObject({ id: created.id, status: { state: "ready" } });
  });

  it("allows one sandbox per conversation", async () => {
    const { chat, deps } = await setup();
    await must(createConversationSandbox(deps, { conversationId: chat.id }));
    expect(
      await createConversationSandbox(deps, { conversationId: chat.id })
    ).toEqual(err({ type: "already_exists" }));
  });

  it("resets to an empty workspace with the same id", async () => {
    const { chat, deps } = await setup();
    const created = await must(
      createConversationSandbox(deps, { conversationId: chat.id })
    );
    await must(
      execInSandbox(deps, { command: "echo x > old.txt", id: created.id })
    );
    const reset = await must(resetSandbox(deps, { id: created.id }));
    expect(reset).toMatchObject({ id: created.id, status: { state: "ready" } });
    expect(
      await must(
        listSandboxFiles(deps, { id: created.id, path: ".", recursive: true })
      )
    ).toEqual([]);
  });

  it("destroys the sandbox and its row", async () => {
    const { chat, deps } = await setup();
    const created = await must(
      createConversationSandbox(deps, { conversationId: chat.id })
    );
    await must(destroySandbox(deps, { id: created.id }));
    expect(await getSandbox(deps.db, created.id)).toBeNull();
    expect(
      await execInSandbox(deps, { command: "ls", id: created.id })
    ).toEqual(err({ type: "not_found" }));
  });

  it("records previews, and says just-bash can't serve them", async () => {
    const memory: ProviderEntry = {
      factory: createMemorySandboxFactory(),
      isolation: () => Promise.resolve(ok("container" as const)),
      limits,
    };
    const { chat, deps } = await setup(
      new Map([
        ["docker", memory],
        ["just-bash", justBash()],
      ])
    );
    const docker = await must(
      createConversationSandbox(deps, {
        conversationId: chat.id,
        provider: "docker",
      })
    );
    expect(docker.isolation).toBe("container");
    const preview = await must(
      exposeSandboxPort(deps, { id: docker.id, port: 5173 })
    );
    expect(preview.port).toBe(5173);
    expect(
      await must(getConversationSandbox(deps, { conversationId: chat.id }))
    ).toMatchObject({ previews: [preview] });

    const other = await setup();
    const scratch = await must(
      createConversationSandbox(other.deps, { conversationId: other.chat.id })
    );
    expect(
      await exposeSandboxPort(other.deps, { id: scratch.id, port: 3000 })
    ).toMatchObject({
      error: { type: "invalid" },
    });
  });

  it("stores a failed start instead of throwing", async () => {
    const broken: ProviderEntry = {
      factory: {
        attach: () =>
          Promise.resolve(
            err({ message: "down", type: "unavailable" as const })
          ),
        create: () =>
          Promise.resolve(
            err({ message: "down", type: "unavailable" as const })
          ),
        provider: "docker",
      },
      isolation: () =>
        Promise.resolve(err({ message: "down", type: "unavailable" as const })),
      limits,
    };
    const { chat, deps } = await setup(new Map([["docker", broken]]));
    const created = await must(
      createConversationSandbox(
        { ...deps, defaultProvider: "docker" },
        { conversationId: chat.id }
      )
    );
    expect(created.status).toEqual({
      message: "The sandbox host is unavailable. Try again in a moment.",
      state: "failed",
    });
    expect(
      await execInSandbox(deps, { command: "ls", id: created.id })
    ).toEqual(err({ message: "down", type: "unavailable" }));
  });

  it("refuses unknown providers and instances without sandboxes", async () => {
    const { chat, deps } = await setup();
    expect(
      await createConversationSandbox(deps, {
        conversationId: chat.id,
        provider: "e2b",
      })
    ).toMatchObject({ error: { type: "invalid" } });
    expect(
      await createConversationSandbox(
        { ...deps, providers: new Map() },
        { conversationId: chat.id }
      )
    ).toEqual(err({ type: "feature_disabled" }));
  });

  it("lets viewers look but not touch, and hides it from strangers", async () => {
    const { chat, deps } = await setup();
    const created = await must(
      createConversationSandbox(deps, { conversationId: chat.id })
    );
    const viewer = await seedUser(testDb.db);
    await upsertGrant(testDb.db, {
      grantedBy: deps.session.userId,
      permission: "viewer",
      principal: { id: viewer.id, type: "user" },
      resource: { resourceId: chat.id, resourceType: "conversation" },
    });
    const asViewer = { ...deps, session: await viewerOf(viewer.id) };
    expect(
      (await getConversationSandbox(asViewer, { conversationId: chat.id })).ok
    ).toBe(true);
    expect(
      (
        await listSandboxFiles(asViewer, {
          id: created.id,
          path: ".",
          recursive: false,
        })
      ).ok
    ).toBe(true);
    expect(
      await execInSandbox(asViewer, { command: "ls", id: created.id })
    ).toEqual(err({ type: "forbidden" }));
    expect(await resetSandbox(asViewer, { id: created.id })).toEqual(
      err({ type: "forbidden" })
    );

    const stranger = await seedUser(testDb.db);
    const asStranger = { ...deps, session: await viewerOf(stranger.id) };
    expect(
      await getConversationSandbox(asStranger, { conversationId: chat.id })
    ).toEqual(err({ type: "not_found" }));
    expect(
      await readSandboxFile(asStranger, { id: created.id, path: "a" })
    ).toEqual(err({ type: "not_found" }));
    expect(await destroySandbox(asStranger, { id: newId("sandbox") })).toEqual(
      err({ type: "not_found" })
    );
  });
});

describe("sandbox exec job", () => {
  const job = (data: unknown) => ({
    completedAt: null,
    createdAt: new Date().toISOString(),
    data: data as never,
    id: newId("job"),
    name: SANDBOX_EXEC_JOB,
    output: null,
    retryCount: 0,
    singletonKey: null,
    startAfter: new Date().toISOString(),
    state: "active" as const,
  });

  /** A chat's just-bash sandbox, with the handler wired to its factory. */
  const jobSetup = async () => {
    const entry = justBash();
    const { chat, deps, owner } = await setup(new Map([["just-bash", entry]]));
    const created = await must(
      createConversationSandbox(deps, { conversationId: chat.id })
    );
    const streamed: string[] = [];
    const handler = createSandboxExecJobHandler({
      attach: entry.factory.attach,
      db: testDb.db,
      onOutput: (_data, chunk) => streamed.push(chunk.data),
    });
    return { chat, created, deps, handler, owner, streamed };
  };

  it("runs a command in the background and streams its output", async () => {
    const { created, handler, owner, streamed } = await jobSetup();
    const result = await handler(
      job({
        command: "echo built",
        requestedBy: owner.id,
        sandboxId: created.id,
      }),
      new AbortController().signal
    );
    expect(result).toMatchObject({
      ok: true,
      value: { exitCode: 0, stdout: "built\n" },
    });
    expect(streamed).toEqual(["built\n"]);
    expect(
      await handler(job({ nope: true }), new AbortController().signal)
    ).toEqual(err("invalid sandbox job data"));
  });

  it("won't run without a requester, or for one who can't run commands there now", async () => {
    const { chat, created, deps, handler, owner, streamed } = await jobSetup();
    const { signal } = new AbortController();
    const command = "echo pwned > owned.txt";
    // Data that only names a sandbox acts as nobody.
    expect(
      await handler(job({ command, sandboxId: created.id }), signal)
    ).toEqual(err("invalid sandbox job data"));

    const stranger = await seedUser(testDb.db);
    expect(
      await handler(
        job({ command, requestedBy: stranger.id, sandboxId: created.id }),
        signal
      )
    ).toEqual(err("not_found"));

    // An editor when it was enqueued, only a viewer by the time it runs.
    const demoted = await seedUser(testDb.db);
    await upsertGrant(testDb.db, {
      grantedBy: owner.id,
      permission: "viewer",
      principal: { id: demoted.id, type: "user" },
      resource: { resourceId: chat.id, resourceType: "conversation" },
    });
    expect(
      await handler(
        job({ command, requestedBy: demoted.id, sandboxId: created.id }),
        signal
      )
    ).toEqual(err("forbidden"));

    // Nothing ran: no output, and the workspace is still empty.
    expect(streamed).toEqual([]);
    expect(
      await listSandboxFiles(deps, {
        id: created.id,
        path: ".",
        recursive: false,
      })
    ).toEqual(ok([]));
  });
});

// The runner keeps exposed ports in memory only (see preview-restore.ts):
// a restart leaves every recorded preview answering 404 until it's exposed
// again, which a read of the running workspace now does.
describe("previews after a runner restart", () => {
  const dockerSetup = async () => {
    let clock = 0;
    const docker = createDockerLikeEntry({ now: () => clock });
    const { chat, deps } = await setup(
      new Map([["docker", docker.entry]]) as SandboxProviders
    );
    const created = await must(
      createConversationSandbox(deps, {
        conversationId: chat.id,
        provider: "docker",
      })
    );
    return {
      advance: (ms: number) => {
        clock += ms;
      },
      chat,
      created,
      deps,
      host: docker.host,
    };
  };

  it("exposes recorded ports again, at most once a minute", async () => {
    const { advance, chat, created, deps, host } = await dockerSetup();
    await must(exposeSandboxPort(deps, { id: created.id, port: 3000 }));
    host.exposed.clear();

    const read = await must(
      getConversationSandbox(deps, { conversationId: chat.id })
    );
    expect(read?.previews.map((preview) => preview.port)).toEqual([3000]);
    expect([...(host.exposed.get(created.id) ?? [])]).toEqual([3000]);
    const calls = host.exposeCalls.get(created.id);

    // The panel reads again: exposing counts as activity, so not every time.
    host.exposed.clear();
    await must(getConversationSandbox(deps, { conversationId: chat.id }));
    expect(host.exposeCalls.get(created.id)).toBe(calls);

    advance(60_000);
    await must(getConversationSandbox(deps, { conversationId: chat.id }));
    expect([...(host.exposed.get(created.id) ?? [])]).toEqual([3000]);
  });

  it("leaves a stopped workspace asleep", async () => {
    const { chat, created, deps, host } = await dockerSetup();
    await must(exposeSandboxPort(deps, { id: created.id, port: 3000 }));
    const calls = host.exposeCalls.get(created.id);
    host.exposed.clear();
    host.stopped.add(created.id);
    const read = await must(
      getConversationSandbox(deps, { conversationId: chat.id })
    );
    expect(read?.status).toEqual({ state: "stopped" });
    expect(host.exposeCalls.get(created.id)).toBe(calls);
  });

  it("brings the static preview's server back, and fixes a URL that moved", async () => {
    const { chat, created, deps, host } = await dockerSetup();
    await recordPreview(deps.db, created.id, {
      port: STATIC_PREVIEW_PORT,
      url: "http://old-origin.test",
    });
    const read = await must(
      getConversationSandbox(deps, { conversationId: chat.id })
    );
    expect(
      host.commands.filter((command) => command.startsWith("nohup node"))
    ).toHaveLength(1);
    expect(read?.previews).toEqual([
      {
        port: STATIC_PREVIEW_PORT,
        url: previewUrlFor(created.id, STATIC_PREVIEW_PORT),
      },
    ]);
  });

  it("has nothing to restore on just-bash", async () => {
    const { chat, deps } = await setup();
    const created = await must(
      createConversationSandbox(deps, { conversationId: chat.id })
    );
    await recordPreview(deps.db, created.id, {
      port: 3000,
      url: "http://preview.test:3000",
    });
    const read = await must(
      getConversationSandbox(deps, { conversationId: chat.id })
    );
    expect(read?.previews).toEqual([
      { port: 3000, url: "http://preview.test:3000" },
    ]);
  });
});
