import { appConfigSchema } from "@workspace/config/schema";
import type { KeyScope } from "@workspace/contract/schemas/keys";
import { instancePolicySchema } from "@workspace/contract/schemas/tenancy";
import { newId } from "@workspace/shared/ids";
import { err } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import type { ProviderCredentials } from "../ports/provider-registry";
import type { KeyStore } from "./key-store";
import {
  createMemoryKeyStore,
  instanceKeysFromConfig,
  withInstanceKeys,
} from "./key-store.memory";
import {
  type KeyContext,
  type KeyPolicy,
  keyedProviders,
  keyScopesFor,
  pickKeys,
  resolveChatKeys,
} from "./resolve";

const userId = newId("user");
const orgId = newId("org");
const team = newId("team");
const parentTeam = newId("team");

const user: KeyScope = { id: userId, type: "user" };
const org: KeyScope = { id: orgId, type: "org" };
const instance: KeyScope = { type: "instance" };
const teamScope: KeyScope = { id: team, type: "team" };
const parentScope: KeyScope = { id: parentTeam, type: "team" };

const personal: KeyContext = { type: "personal", userId };
const inTeam: KeyContext = {
  orgId,
  teamPath: [team, parentTeam],
  type: "team",
  userId,
};
const inOrg: KeyContext = { orgId, type: "org", userId };

const policy = ({
  fallback = false,
  instanceAllows = "allowed" as const,
  instanceKeys = {},
}: {
  fallback?: boolean;
  instanceAllows?: "allowed" | "forbidden";
  instanceKeys?: { org?: boolean; personal?: boolean; team?: boolean };
} = {}): KeyPolicy => ({
  instance: instancePolicySchema.parse({
    instanceKeys,
    personalKeyFallback: instanceAllows,
  }),
  org: { personalKeyFallback: fallback },
});

describe("keyScopesFor", () => {
  it.each<[string, KeyContext, KeyPolicy, KeyScope[]]>([
    [
      "personal: user, then instance (default on)",
      personal,
      policy(),
      [user, instance],
    ],
    [
      "personal without instance keys",
      personal,
      policy({ instanceKeys: { personal: false } }),
      [user],
    ],
    [
      "team: team, ancestors, org",
      inTeam,
      policy(),
      [teamScope, parentScope, org],
    ],
    [
      "team with personal fallback and instance keys",
      inTeam,
      policy({ fallback: true, instanceKeys: { team: true } }),
      [teamScope, parentScope, org, user, instance],
    ],
    [
      "team: an instance that forbids fallback wins over the org",
      inTeam,
      policy({ fallback: true, instanceAllows: "forbidden" }),
      [teamScope, parentScope, org],
    ],
    ["org: org only by default", inOrg, policy(), [org]],
    [
      "org with fallback and instance keys",
      inOrg,
      policy({ fallback: true, instanceKeys: { org: true } }),
      [org, user, instance],
    ],
    [
      "org: instance keys for teams don't apply to org chats",
      inOrg,
      policy({ instanceKeys: { team: true } }),
      [org],
    ],
  ])("%s", (_name, context, keyPolicy, expected) => {
    expect(keyScopesFor(context, keyPolicy)).toEqual(expected);
  });
});

const credential = (
  provider: string,
  source: KeyScope
): ProviderCredentials => ({
  apiKey: `test-${provider}-${source.type}`,
  provider,
  source,
});

describe("pickKeys", () => {
  it.each<
    [string, KeyScope[], ProviderCredentials[], Record<string, KeyScope>]
  >([
    ["nothing configured", [user, instance], [], {}],
    [
      "the nearest scope wins per provider",
      [teamScope, parentScope, org],
      [
        credential("anthropic", org),
        credential("anthropic", parentScope),
        credential("openai", org),
      ],
      { anthropic: parentScope, openai: org },
    ],
    [
      "keys from scopes outside the list are ignored",
      [org],
      [credential("anthropic", user), credential("openai", instance)],
      {},
    ],
    [
      "a sibling team's key doesn't leak in",
      [teamScope, org],
      [credential("anthropic", { id: newId("team"), type: "team" })],
      {},
    ],
  ])("%s", (_name, scopes, keys, expected) => {
    const picked = pickKeys(scopes, keys);
    expect(
      Object.fromEntries(Object.entries(picked).map(([p, k]) => [p, k.source]))
    ).toEqual(expected);
  });
});

describe("resolveChatKeys", () => {
  const config = appConfigSchema.parse({
    providers: { anthropic: { apiKey: "test-instance-key" }, openai: {} },
  });
  const store = withInstanceKeys(
    createMemoryKeyStore([
      credential("openai", user),
      credential("anthropic", teamScope),
    ]),
    instanceKeysFromConfig(config)
  );

  it("combines database and instance keys in D17 order", async () => {
    const result = await resolveChatKeys(personal, store, policy());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.openai?.source).toEqual(user);
      expect(result.value.anthropic?.source).toEqual(instance);
      expect(keyedProviders(result.value)).toEqual(
        new Set(["anthropic", "openai"])
      );
    }
  });

  it("uses the team's key in a team chat and ignores personal keys by default", async () => {
    const result = await resolveChatKeys(inTeam, store, policy());
    expect(result.ok && Object.keys(result.value)).toEqual(["anthropic"]);
    expect(result.ok && result.value.anthropic?.source).toEqual(teamScope);
  });

  it("passes a store failure through", async () => {
    const failing: KeyStore = {
      keysFor: () =>
        Promise.resolve(err({ message: "db down", type: "unavailable" })),
    };
    expect(await resolveChatKeys(inOrg, failing, policy())).toEqual({
      error: { message: "db down", type: "unavailable" },
      ok: false,
    });
  });
});
