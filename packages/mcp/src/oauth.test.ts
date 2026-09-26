import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createMcpManager, type McpManager } from "./manager";
import { createMemoryFlowStore, createMemoryTokenStore } from "./oauth";
import { fromLibraryRow, type McpServerConfig } from "./server-config";
import { type McpFixture, startMcpFixture } from "./testing/fixture-server";

const alice = newId("user");
const bob = newId("user");
const carol = newId("user");
const REDIRECT = "http://app.example.test/api/mcp/oauth/callback";

let fixture: McpFixture;
let server: McpServerConfig;
beforeAll(async () => {
  fixture = await startMcpFixture({ oauth: true });
  const parsed = fromLibraryRow({
    definition: {
      auth: { scopes: ["tools"], type: "oauth" },
      kind: "mcp_server",
      transport: "http",
      url: fixture.url,
    },
    id: newId("libraryItem"),
    name: "Tracker",
    // Published to an org: everyone in it uses the one definition, but
    // each person signs in as themselves.
    ownerId: newId("org"),
    ownerType: "org",
    secretCiphertext: null,
    secretKeyId: null,
  });
  if (!parsed.ok) {
    throw new Error(parsed.error.type);
  }
  server = parsed.value;
});
afterAll(() => fixture.close());

let clock = Date.now();
let manager: McpManager;
let store: ReturnType<typeof createMemoryTokenStore>;
const setup = () => {
  store = createMemoryTokenStore();
  manager = createMcpManager({
    allowPrivateNetworks: true,
    clientName: "test-client",
    now: () => clock,
    oauth: {
      flows: createMemoryFlowStore({ now: () => clock }),
      settings: { clientName: "test-client", redirectUrl: REDIRECT },
      store,
    },
    resolveServer: (id) =>
      Promise.resolve(
        id === server.id ? ok(server) : err({ serverId: id, type: "not_found" })
      ),
    sweepIntervalMs: 0,
  });
};
afterEach(() => manager.close());

/** Start, approve as `identity`, and deliver the callback as `asUser`. */
const signIn = async (user: typeof alice, identity: string, asUser = user) => {
  const url = await manager.startOAuth(server.id, user);
  if (!url.ok) {
    throw new Error(url.error.type);
  }
  const query = fixture.approve(url.value, identity);
  return manager.completeOAuth(
    { code: query.get("code") ?? "", state: query.get("state") ?? "" },
    asUser
  );
};

const whoami = async (user: typeof alice) => {
  const tools = await manager.toolSource(user).tools({ id: server.id });
  if (!tools.ok) {
    return tools.error.type;
  }
  const result = await tools.value.tracker__whoami?.execute?.({}, {
    messages: [],
    toolCallId: "w",
  } as never);
  return (result as { content: { text: string }[] }).content[0]?.text;
};

describe("MCP OAuth", () => {
  it("discovers, registers, signs in with PKCE and connects", async () => {
    setup();
    expect(await manager.status(server.id, alice)).toEqual({
      state: "needs_auth",
    });
    const url = await manager.startOAuth(server.id, alice);
    expect(url.ok && url.value.origin).toBe(fixture.origin);
    expect(url.ok && url.value.searchParams.get("code_challenge_method")).toBe(
      "S256"
    );
    expect(url.ok && url.value.searchParams.get("scope")).toBe("tools");
    const query = fixture.approve(url.ok ? url.value : "", "alice@example");
    expect(
      await manager.completeOAuth(
        { code: query.get("code") ?? "", state: query.get("state") ?? "" },
        alice
      )
    ).toEqual({ ok: true, value: server.id });
    expect(await manager.status(server.id, alice)).toEqual({
      state: "connected",
      toolCount: 3,
    });
    expect(await whoami(alice)).toBe("alice@example");
  });

  it("keeps users apart: own tokens, own connection", async () => {
    setup();
    await signIn(alice, "alice@example");
    await signIn(bob, "bob@example");
    expect(await whoami(alice)).toBe("alice@example");
    expect(await whoami(bob)).toBe("bob@example");
    // Carol never signed in: no borrowing someone else's connection.
    expect(await whoami(carol)).toBe("unauthorized");
    expect(manager.openConnections()).toBe(2);
  });

  it("refuses a callback delivered to another user's session", async () => {
    setup();
    const stolen = await signIn(alice, "alice@example", bob);
    expect(stolen).toMatchObject({ error: { type: "oauth_failed" } });
    expect(await manager.status(server.id, bob)).toEqual({
      state: "needs_auth",
    });
    // And the state was spent: replaying it as Alice fails too.
    expect(store.size()).toBe(0);
  });

  it("expires flows that aren't finished in time", async () => {
    setup();
    const url = await manager.startOAuth(server.id, alice);
    const query = fixture.approve(url.ok ? url.value : "", "alice@example");
    clock += 60 * 60 * 1000;
    expect(
      await manager.completeOAuth(
        { code: query.get("code") ?? "", state: query.get("state") ?? "" },
        alice
      )
    ).toMatchObject({ error: { type: "oauth_failed" } });
  });

  it("refreshes an expired token instead of asking again", async () => {
    setup();
    await signIn(alice, "alice@example");
    expect(await whoami(alice)).toBe("alice@example");
    const grants = fixture.stats.tokenGrants.length;
    const { registrations } = fixture.stats;

    // Proactively, before connecting: the stored token is past its expiry.
    await manager.close();
    fixture.expireAccessTokens();
    clock += 2 * 60 * 60 * 1000;
    const before = await store.load(server.id, alice);
    expect(await whoami(alice)).toBe("alice@example");
    expect(fixture.stats.tokenGrants.slice(grants)).toEqual(["refresh_token"]);
    const after = await store.load(server.id, alice);
    expect(after.ok && before.ok && after.value?.tokens.access_token).not.toBe(
      before.ok && before.value?.tokens.access_token
    );

    // Reactively, on a 401 from a live connection.
    fixture.expireAccessTokens();
    expect(await whoami(alice)).toBe("alice@example");
    expect(fixture.stats.tokenGrants.slice(grants)).toEqual([
      "refresh_token",
      "refresh_token",
    ]);

    // Signing in again reuses the registered client.
    expect(await signIn(alice, "alice@example")).toMatchObject({ ok: true });
    expect(fixture.stats.registrations).toBe(registrations);

    // Disconnecting forgets the tokens.
    await manager.disconnectOAuth(server.id, alice);
    expect(await manager.status(server.id, alice)).toEqual({
      state: "needs_auth",
    });
  });

  it("reports OAuth as unconfigured without a callback URL", async () => {
    const bare = createMcpManager({
      allowPrivateNetworks: true,
      clientName: "test-client",
      resolveServer: () => Promise.resolve(ok(server)),
      sweepIntervalMs: 0,
    });
    manager = bare;
    expect(await bare.status(server.id, alice)).toMatchObject({
      state: "error",
    });
    expect(await bare.startOAuth(server.id, alice)).toMatchObject({
      error: { type: "oauth_unavailable" },
    });
  });
});
