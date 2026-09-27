import { call, ORPCError } from "@orpc/server";
import { authRouter } from "@workspace/auth/handlers";
import {
  type HandlerContext,
  resolveSession,
} from "@workspace/auth/handlers/context";
import {
  createTestAuth,
  type SignedIn,
  signUp,
  type TestAuth,
} from "@workspace/auth/testing";
import type { OrgId, TeamId } from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import { getMcpServer } from "@workspace/db/queries/mcp";
import { keyRingOf, MCP_HEADER_SECRET_AAD, open } from "@workspace/mcp/crypto";
import { ok } from "@workspace/shared/result";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestContext } from "../context";
import { libreChatAgentToDefinition } from "./librechat";
import { createLibraryRouter, loadSharedLibraryItem } from "./router";

// The library group in-process over PGlite, with real users, orgs and teams
// from the auth package. The first block is PLAN.md §11 M1 step 5.

let current: TestAuth | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const KEY = Buffer.alloc(32, 7);

const setup = async (overrides: Record<string, unknown> = {}) => {
  current = await createTestAuth({}, overrides);
  const t = current;
  const router = createLibraryRouter({ db: t.db, keys: ok(keyRingOf(KEY)) });
  return { router, t };
};

type Router = Awaited<ReturnType<typeof setup>>["router"];

const authContext = async (
  t: TestAuth,
  who: SignedIn,
  extra: Partial<HandlerContext> = {}
): Promise<HandlerContext> => ({
  appUrl: "https://chat.example.test",
  auth: t.auth,
  config: t.config,
  db: t.db,
  headers: who.headers,
  session: await resolveSession(t.auth, who.headers),
  ...extra,
});

const as = (who: SignedIn): { context: RequestContext } => ({
  context: {
    request: new Request("https://chat.example.test/api/library"),
    session: { userId: who.userId },
  },
});

/** The typed error a procedure threw: its code and, for `CONFLICT`, the reason. */
const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ORPCError) {
      const reason = (error.data as { reason?: string } | undefined)?.reason;
      return reason ? `${error.code}:${reason}` : error.code;
    }
    throw error;
  }
  throw new Error("expected the procedure to fail");
};

const agentDefinition = (instructions: string): AgentDefinition => ({
  approvals: { default: "auto", tools: {} },
  conversationStarters: ["Review my PR"],
  instructions,
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "fast",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
});

/** An org owned by an admin with Eng › Platform; A in Eng, B in Platform. */
const acme = async (t: TestAuth) => {
  const admin = await signUp(t.auth, "admin@example.test");
  const adminCtx = await authContext(t, admin);
  const org = await call(
    authRouter.orgs.create,
    { name: "Acme", slug: "acme" },
    { context: adminCtx }
  );
  const eng = await call(
    authRouter.teams.create,
    { name: "Eng", orgId: org.id, parentId: null },
    { context: adminCtx }
  );
  const platform = await call(
    authRouter.teams.create,
    { name: "Platform", orgId: org.id, parentId: eng.id },
    { context: adminCtx }
  );
  const join = async (email: string, teamIds: TeamId[]) => {
    const invitation = await call(
      authRouter.orgs.invite,
      { email, orgId: org.id as OrgId, role: "member", teamIds },
      { context: adminCtx }
    );
    const who = await signUp(t.auth, email);
    await call(
      authRouter.orgs.acceptInvitation,
      { id: invitation.id },
      { context: await authContext(t, who) }
    );
    return who;
  };
  const a = await join("a@example.test", [eng.id]);
  const b = await join("b@example.test", [platform.id]);
  return { a, adminCtx, b, eng, org, platform };
};

/** A creates an agent and publishes v1 of it. */
const publishedAgent = async (
  router: Router,
  a: SignedIn,
  name = "Reviewer"
) => {
  const created = await call(
    router.library.create,
    { definition: agentDefinition("Be terse."), name },
    as(a)
  );
  await call(router.library.publishVersion, { id: created.id }, as(a));
  return created;
};

describe("sharing and publishing (§11 M1 step 5)", () => {
  it("publishing to Eng lets a Platform member use it without seeing the instructions", async () => {
    const { router, t } = await setup();
    const { a, b, eng } = await acme(t);
    const source = await publishedAgent(router, a);

    const copy = await call(
      router.library.publishToLibrary,
      { id: source.id, target: { id: eng.id, type: "team" } },
      as(a)
    );
    expect(copy).toMatchObject({
      latestVersionNumber: 1,
      maintainers: [expect.objectContaining({ id: a.userId })],
      myAccess: "maintainer",
      owner: { id: eng.id, type: "team" },
      publishedFrom: source.id,
      visibility: "published",
    });

    // B is in Platform, under Eng: the team library shows it.
    const listed = await call(
      router.library.list,
      { limit: 50, tab: "libraries" },
      as(b)
    );
    expect(listed.items.map((item) => item.id)).toEqual([copy.id]);
    expect(listed.items[0]?.myAccess).toBe("use");

    const seen = await call(router.library.get, { id: copy.id }, as(b));
    expect(seen.definition).toBeNull();
    expect(seen.versionId).toBe(copy.latestVersionId);
    expect(seen.draftVersionId).toBeNull();
    expect(
      await failure(
        call(router.library.get, { id: copy.id, revision: "draft" }, as(b))
      )
    ).toBe("FORBIDDEN");
    expect(
      await failure(call(router.library.export, { id: copy.id }, as(b)))
    ).toBe("FORBIDDEN");
    // A's personal original stays A's.
    expect(
      await failure(call(router.library.get, { id: source.id }, as(b)))
    ).toBe("NOT_FOUND");
  });

  it("a view grant shows the instructions and lets B duplicate", async () => {
    const { router, t } = await setup();
    const { a, b, eng } = await acme(t);
    const source = await publishedAgent(router, a);
    const copy = await call(
      router.library.publishToLibrary,
      { id: source.id, target: { id: eng.id, type: "team" } },
      as(a)
    );
    // Maintainers share the library's copy.
    await call(
      authRouter.grants.create,
      {
        permission: "view",
        principal: { id: b.userId, type: "user" },
        resourceId: copy.id,
        resourceType: "agent",
      },
      { context: await authContext(t, a) }
    );

    const seen = await call(router.library.get, { id: copy.id }, as(b));
    expect(seen.myAccess).toBe("view");
    expect(seen.definition).toMatchObject({ instructions: "Be terse." });

    const mine = await call(
      router.library.duplicate,
      { id: copy.id, name: "My reviewer" },
      as(b)
    );
    expect(mine).toMatchObject({
      latestVersionId: null,
      myAccess: "owner",
      name: "My reviewer",
      owner: { id: b.userId, type: "user" },
      visibility: "private",
    });
    expect(mine.definition).toMatchObject({ instructions: "Be terse." });
    const tab = await call(
      router.library.list,
      { limit: 50, tab: "mine" },
      as(b)
    );
    expect(tab.items.map((item) => item.id)).toEqual([mine.id]);
    // `view` is still not `edit`.
    expect(
      await failure(
        call(router.library.update, { id: copy.id, name: "Mine now" }, as(b))
      )
    ).toBe("FORBIDDEN");
  });

  it("removing the publisher from the org leaves the published agent working", async () => {
    const { router, t } = await setup();
    const { a, adminCtx, b, eng, org } = await acme(t);
    const source = await publishedAgent(router, a);
    const copy = await call(
      router.library.publishToLibrary,
      { id: source.id, target: { id: eng.id, type: "team" } },
      as(a)
    );

    await call(
      authRouter.orgs.removeMember,
      { orgId: org.id, userId: a.userId },
      { context: adminCtx }
    );

    const seen = await call(router.library.get, { id: copy.id }, as(b));
    expect(seen).toMatchObject({
      latestVersionId: copy.latestVersionId,
      myAccess: "use",
      owner: { id: eng.id, type: "team" },
    });
    // A left the library, so A keeps no hold on it, maintainer or not.
    expect(
      await failure(call(router.library.get, { id: copy.id }, as(a)))
    ).toBe("NOT_FOUND");
    expect(
      await failure(
        call(router.library.update, { id: copy.id, name: "Mine" }, as(a))
      )
    ).toBe("NOT_FOUND");
  });

  it("a share lands in Shared with me: B can use it, and edit only once granted edit", async () => {
    const { router, t } = await setup();
    const { a, b } = await acme(t);
    const agent = await publishedAgent(router, a, "Helper");
    const aCtx = await authContext(t, a);

    const grant = await call(
      authRouter.grants.create,
      {
        permission: "use",
        principal: { id: b.userId, type: "user" },
        resourceId: agent.id,
        resourceType: "agent",
      },
      { context: aCtx }
    );

    const shared = await call(
      router.library.list,
      { limit: 50, tab: "shared" },
      as(b)
    );
    expect(shared.items.map((item) => item.id)).toEqual([agent.id]);
    expect(shared.items[0]).toMatchObject({
      myAccess: "use",
      visibility: "shared",
    });
    const seen = await call(router.library.get, { id: agent.id }, as(b));
    expect(seen.definition).toBeNull();
    expect(seen.versionId).toBe(seen.latestVersionId);

    const edit = { definition: agentDefinition("Be kind."), id: agent.id };
    expect(await failure(call(router.library.update, edit, as(b)))).toBe(
      "FORBIDDEN"
    );
    expect(
      await failure(
        call(router.library.publishVersion, { id: agent.id }, as(b))
      )
    ).toBe("FORBIDDEN");

    await call(
      authRouter.grants.update,
      { id: grant.id, permission: "edit" },
      { context: aCtx }
    );
    const edited = await call(router.library.update, edit, as(b));
    expect(edited).toMatchObject({
      definition: { instructions: "Be kind." },
      myAccess: "edit",
    });
    // Editors can't reshare, delete or publish it into a library: that's the owner's.
    expect(
      await failure(call(router.library.delete, { id: agent.id }, as(b)))
    ).toBe("FORBIDDEN");
  });
});

describe("drafts and versions", () => {
  it("edits a draft, publishes versions, lists and restores them", async () => {
    const { router, t } = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    const created = await call(
      router.library.create,
      {
        definition: {
          command: "explain",
          kind: "prompt",
          template: "Explain {{topic}}.",
          variables: [{ name: "topic" }],
        },
        name: "Explain",
      },
      as(ada)
    );
    expect(created).toMatchObject({
      latestVersionId: null,
      myAccess: "owner",
      versionId: created.draftVersionId,
      visibility: "private",
    });

    const v1 = await call(
      router.library.publishVersion,
      { id: created.id, notes: "First" },
      as(ada)
    );
    expect(v1).toMatchObject({
      notes: "First",
      number: 1,
      status: "published",
    });
    expect(
      await failure(
        call(router.library.publishVersion, { id: created.id }, as(ada))
      )
    ).toBe("CONFLICT:already_exists");

    await call(
      router.library.update,
      {
        definition: {
          kind: "prompt",
          template: "Explain {{topic}} simply.",
          variables: [{ name: "topic" }],
        },
        id: created.id,
      },
      as(ada)
    );
    await call(router.library.publishVersion, { id: created.id }, as(ada));

    const versions = await call(
      router.library.listVersions,
      { id: created.id, limit: 10 },
      as(ada)
    );
    expect(versions.items.map((v) => [v.number, v.status])).toEqual([
      [2, "published"],
      [1, "published"],
      [null, "draft"],
    ]);
    const paged = await call(
      router.library.listVersions,
      { id: created.id, limit: 2 },
      as(ada)
    );
    expect(paged.items).toHaveLength(2);
    const rest = await call(
      router.library.listVersions,
      { cursor: paged.nextCursor ?? "", id: created.id, limit: 2 },
      as(ada)
    );
    expect(rest.items.map((v) => v.status)).toEqual(["draft"]);

    const restored = await call(
      router.library.restoreVersion,
      { id: created.id, versionId: v1.id },
      as(ada)
    );
    expect(restored.definition).toMatchObject({
      template: "Explain {{topic}}.",
    });
    const latest = await call(router.library.get, { id: created.id }, as(ada));
    expect(latest.definition).toMatchObject({
      template: "Explain {{topic}} simply.",
    });
  });

  it("searches and filters my library by kind", async () => {
    const { router, t } = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    await call(
      router.library.create,
      { definition: agentDefinition("x"), name: "Code reviewer" },
      as(ada)
    );
    await call(
      router.library.create,
      {
        definition: { kind: "prompt", template: "Hi", variables: [] },
        name: "Greeting",
      },
      as(ada)
    );
    const found = await call(
      router.library.list,
      { limit: 50, query: "review", tab: "mine" },
      as(ada)
    );
    expect(found.items.map((item) => item.name)).toEqual(["Code reviewer"]);
    const prompts = await call(
      router.library.list,
      { kind: "prompt", limit: 50, tab: "mine" },
      as(ada)
    );
    expect(prompts.items.map((item) => item.name)).toEqual(["Greeting"]);
    const first = await call(
      router.library.list,
      { limit: 1, tab: "mine" },
      as(ada)
    );
    const second = await call(
      router.library.list,
      { cursor: first.nextCursor ?? "", limit: 1, tab: "mine" },
      as(ada)
    );
    expect([...first.items, ...second.items].map((i) => i.name).sort()).toEqual(
      ["Code reviewer", "Greeting"]
    );
    expect(second.nextCursor).toBeNull();
  });
});

describe("MCP servers", () => {
  it("seals header secrets, never returns them, and drops them when the URL changes", async () => {
    const { router, t } = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    const created = await call(
      router.library.create,
      {
        definition: {
          auth: {
            headerName: "Authorization",
            type: "header",
            value: "Bearer s3cret",
          },
          kind: "mcp_server",
          transport: "http",
          url: "https://mcp.example.test/mcp",
        },
        name: "Docs",
      },
      as(ada)
    );
    expect(created.definition).toEqual({
      auth: { configured: true, headerName: "Authorization", type: "header" },
      kind: "mcp_server",
      transport: "http",
      url: "https://mcp.example.test/mcp",
    });
    expect(JSON.stringify(created)).not.toContain("s3cret");
    const row = await getMcpServer(t.db, created.id);
    expect(row.ok && row.value.secretCiphertext).toBeTruthy();
    if (row.ok && row.value.secretCiphertext && row.value.secretKeyId) {
      const opened = open(
        keyRingOf(KEY),
        {
          ciphertext: row.value.secretCiphertext,
          keyId: row.value.secretKeyId,
        },
        MCP_HEADER_SECRET_AAD
      );
      expect(opened).toEqual({ ok: true, value: "Bearer s3cret" });
    }

    // Renaming keeps the secret.
    const renamed = await call(
      router.library.update,
      {
        definition: {
          auth: { headerName: "Authorization", type: "header" },
          kind: "mcp_server",
          transport: "http",
          url: "https://mcp.example.test/mcp",
        },
        id: created.id,
        name: "Docs server",
      },
      as(ada)
    );
    expect(renamed.definition).toMatchObject({ auth: { configured: true } });

    // A new URL without the secret re-entered drops it.
    const moved = await call(
      router.library.update,
      {
        definition: {
          auth: { headerName: "Authorization", type: "header" },
          kind: "mcp_server",
          transport: "http",
          url: "https://elsewhere.example.test/mcp",
        },
        id: created.id,
      },
      as(ada)
    );
    expect(moved.definition).toMatchObject({ auth: { configured: false } });

    const exported = await call(
      router.library.export,
      { id: created.id },
      as(ada)
    );
    expect(exported.definition).toMatchObject({ auth: { configured: false } });
  });

  it("refuses a header secret when no encryption key is available", async () => {
    current = await createTestAuth();
    const t = current;
    const router = createLibraryRouter({
      db: t.db,
      keys: { error: { message: "missing", type: "missing_key" }, ok: false },
    });
    const ada = await signUp(t.auth, "ada@example.test");
    expect(
      await failure(
        call(
          router.library.create,
          {
            definition: {
              auth: { headerName: "X-Key", type: "header", value: "k" },
              kind: "mcp_server",
              transport: "sse",
              url: "https://mcp.example.test/sse",
            },
            name: "Keyed",
          },
          as(ada)
        )
      )
    ).toBe("VALIDATION");
  });
});

describe("import, export and public links", () => {
  it("round-trips our own export and maps a LibreChat agent", async () => {
    const { router, t } = await setup();
    const ada = await signUp(t.auth, "ada@example.test");
    const agent = await publishedAgent(router, ada);
    const exported = await call(
      router.library.export,
      { id: agent.id },
      as(ada)
    );
    const imported = await call(
      router.library.import,
      { document: exported },
      as(ada)
    );
    expect(imported).toMatchObject({
      definition: { instructions: "Be terse." },
      name: "Reviewer",
    });

    const libreChat = await call(
      router.library.import,
      {
        document: {
          data: {
            conversation_starters: ["Hello"],
            description: "From LibreChat",
            id: "agent_abc",
            instructions: "Answer in French.",
            model: "gpt-5",
            model_parameters: { max_tokens: 800, temperature: 0.3 },
            name: "Traducteur",
            provider: "openAI",
            tools: ["web_search", "execute_code", "search_mcp_github", "dalle"],
          },
          format: "librechat-agent",
        },
      },
      as(ada)
    );
    expect(libreChat).toMatchObject({
      definition: {
        conversationStarters: ["Hello"],
        instructions: "Answer in French.",
        model: "openai:gpt-5",
        parameters: { maxOutputTokens: 800, temperature: 0.3 },
        sandboxProvider: "just-bash",
        tools: ["web_search", "bash"],
      },
      description: "From LibreChat",
      name: "Traducteur",
    });
    expect(
      await failure(
        call(
          router.library.import,
          { document: { data: { name: "" }, format: "librechat-agent" } },
          as(ada)
        )
      )
    ).toBe("VALIDATION");
  });

  it("falls back to the default model when a LibreChat model doesn't map", () => {
    const mapped = libreChatAgentToDefinition(
      { model: "gpt 5", name: "X", provider: "Open AI" },
      "fast"
    );
    expect(mapped.success && mapped.data.definition.model).toBe("fast");
  });

  it("serves a public link to a library item through the share-link resolver", async () => {
    const { router, t } = await setup({ features: { publicLinks: true } });
    const ada = await signUp(t.auth, "ada@example.test");
    const agent = await publishedAgent(router, ada);
    const ctx = await authContext(t, ada, {
      loadSharedResource: loadSharedLibraryItem(t.db),
    });
    const link = await call(
      authRouter.shareLinks.create,
      { resourceId: agent.id, resourceType: "agent" },
      { context: ctx }
    );
    const listed = await call(router.library.get, { id: agent.id }, as(ada));
    expect(listed.visibility).toBe("public-link");
    const shared = await call(
      authRouter.shareLinks.resolve,
      { token: link.token },
      { context: { ...ctx, session: null } }
    );
    expect(shared).toMatchObject({
      item: { definition: { instructions: "Be terse." }, name: "Reviewer" },
      resourceType: "agent",
    });
  });
});
