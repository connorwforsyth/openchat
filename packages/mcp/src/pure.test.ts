import { libraryItemIdSchema } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import { describe, expect, it } from "vitest";

import { toStatus, toToolError } from "./errors";
import {
  backoffDelay,
  classifyError,
  closedCircuit,
  DEFAULT_CIRCUIT,
  DEFAULT_RECONNECT,
  isCircuitOpen,
  recordFailedRound,
  wasNotDelivered,
} from "./lifecycle";
import {
  checkServerUrl,
  connectionKey,
  fromInstanceConfig,
  fromLibraryRow,
  instanceServerId,
} from "./server-config";
import {
  isToolAllowed,
  namespacedToolName,
  normalizeServerName,
  TOOL_NAME_MAX,
} from "./tool-names";

const HASHED_SERVER = /^server_[0-9a-f]{8}$/;
const PROVIDER_SAFE = /^[a-zA-Z0-9_-]+$/;
const userId = newId("user");
const row = (definition: unknown, extra: object = {}) => ({
  definition: definition as never,
  id: newId("libraryItem"),
  name: "Docs",
  ownerId: userId,
  ownerType: "user" as const,
  secretCiphertext: null,
  secretKeyId: null,
  ...extra,
});

describe("tool names", () => {
  it("namespaces as server__tool within provider limits", () => {
    expect(namespacedToolName("GitHub", "list_issues")).toBe(
      "github__list_issues"
    );
    expect(namespacedToolName("My  Docs!!", "search.v2")).toBe(
      "my_docs__search_v2"
    );
    // The server half never contains `__`, so the first `__` splits.
    expect(normalizeServerName("a__b")).toBe("a_b");
    expect(normalizeServerName("???")).toMatch(HASHED_SERVER);

    const long = namespacedToolName("x".repeat(80), "y".repeat(80));
    expect(long.length).toBeLessThanOrEqual(TOOL_NAME_MAX);
    expect(long).toMatch(PROVIDER_SAFE);
    expect(long).not.toBe(namespacedToolName("x".repeat(80), "y".repeat(81)));
  });

  it("filters by allow, deny and the agent's subset", () => {
    expect(isToolAllowed("echo", { deny: [] })).toBe(true);
    expect(isToolAllowed("echo", { deny: ["echo"] })).toBe(false);
    expect(isToolAllowed("echo", { allow: ["add"], deny: [] })).toBe(false);
    expect(isToolAllowed("echo", { allow: ["echo"], deny: ["echo"] })).toBe(
      false
    );
    expect(isToolAllowed("echo", { deny: [] }, ["add"])).toBe(false);
    expect(isToolAllowed("echo", { deny: [] }, ["echo"])).toBe(true);
  });
});

describe("server config", () => {
  it("gives instance servers stable, valid ids", () => {
    const id = instanceServerId("docs");
    expect(libraryItemIdSchema.safeParse(id).success).toBe(true);
    expect(instanceServerId("docs")).toBe(id);
    expect(instanceServerId("other")).not.toBe(id);
  });

  it("maps a library row, and rejects stdio server-side", () => {
    const http = fromLibraryRow(
      row({
        auth: { type: "none" },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test/mcp",
      })
    );
    expect(http).toMatchObject({
      ok: true,
      value: { owner: { type: "user" }, transport: "http", trusted: false },
    });

    expect(
      toStatus(
        (() => {
          const stdio = fromLibraryRow(
            row({ command: "npx", kind: "mcp_server", transport: "stdio" })
          );
          if (stdio.ok) {
            throw new Error("stdio should be rejected");
          }
          expect(stdio.error.type).toBe("unsupported_transport");
          return stdio.error;
        })()
      )
    ).toEqual({ state: "disabled" });
  });

  it("changes version when the definition changes", () => {
    const a = fromInstanceConfig({
      headers: {},
      name: "docs",
      transport: "http",
      url: "https://a.example.test/mcp",
    });
    const b = fromInstanceConfig({
      headers: {},
      name: "docs",
      transport: "http",
      url: "https://b.example.test/mcp",
    });
    expect(a.id).toBe(b.id);
    expect(a.version).not.toBe(b.version);
  });

  it("shares connections unless credentials are per user", () => {
    const shared = fromInstanceConfig({
      headers: {},
      name: "docs",
      transport: "http",
      url: "https://a.example.test/mcp",
    });
    expect(connectionKey(shared, "u1")).toBe(connectionKey(shared, "u2"));
    const oauth = { ...shared, auth: { scopes: [], type: "oauth" as const } };
    expect(connectionKey(oauth, "u1")).not.toBe(connectionKey(oauth, "u2"));
  });

  it("keeps library servers off the private network", () => {
    const blocked = (url: string) =>
      checkServerUrl({ trusted: false, url }).ok === false;
    expect(blocked("http://127.0.0.1:8080/mcp")).toBe(true);
    expect(blocked("http://169.254.169.254/latest")).toBe(true);
    expect(blocked("http://localhost/mcp")).toBe(true);
    expect(blocked("https://mcp.example.com/mcp")).toBe(false);
    expect(
      checkServerUrl({ trusted: true, url: "http://10.0.0.2/mcp" }).ok
    ).toBe(true);
    expect(
      checkServerUrl(
        { trusted: false, url: "http://127.0.0.1/mcp" },
        { allowPrivateNetworks: true }
      ).ok
    ).toBe(true);
  });
});

describe("lifecycle policy", () => {
  it("backs off exponentially with jitter, capped", () => {
    expect(backoffDelay(DEFAULT_RECONNECT, 1, () => 0)).toBe(2000);
    expect(backoffDelay(DEFAULT_RECONNECT, 2, () => 0)).toBe(4000);
    expect(backoffDelay(DEFAULT_RECONNECT, 10, () => 0.5)).toBe(30_500);
  });

  it("opens the breaker after repeated failed rounds and resets the window", () => {
    let state = closedCircuit(0);
    state = recordFailedRound(state, DEFAULT_CIRCUIT, 1000);
    state = recordFailedRound(state, DEFAULT_CIRCUIT, 2000);
    expect(isCircuitOpen(state, 2001)).toBe(false);
    state = recordFailedRound(state, DEFAULT_CIRCUIT, 3000);
    expect(isCircuitOpen(state, 3001)).toBe(true);
    expect(isCircuitOpen(state, 3000 + DEFAULT_CIRCUIT.baseBackoffMs)).toBe(
      false
    );
    // A fourth failure doubles the wait.
    const again = recordFailedRound(state, DEFAULT_CIRCUIT, 4000);
    expect(again.openUntil - 4000).toBe(DEFAULT_CIRCUIT.baseBackoffMs * 2);
    // Outside the window the count starts over.
    const later = recordFailedRound(again, DEFAULT_CIRCUIT, 1_000_000);
    expect(later.failedRounds).toBe(1);
  });

  it("classifies failures without leaking what the server said", () => {
    const http = (statusCode: number, message = "boom sk-secret") =>
      Object.assign(new Error(message), { statusCode });
    expect(classifyError(http(401))).toEqual({ type: "needs_auth" });
    expect(classifyError(http(429)).type).toBe("unavailable");
    expect(JSON.stringify(classifyError(http(500)))).not.toContain("sk-secret");
    expect(wasNotDelivered(http(404))).toBe(true);
    expect(
      wasNotDelivered(
        new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })
      )
    ).toBe(true);
    expect(wasNotDelivered(http(500))).toBe(false);
    expect(toToolError({ type: "needs_auth" }).type).toBe("unauthorized");
  });
});
