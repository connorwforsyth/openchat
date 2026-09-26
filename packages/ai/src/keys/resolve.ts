import {
  orgIdSchema,
  teamIdSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import type { KeyScope } from "@workspace/contract/schemas/keys";
import type {
  InstancePolicy,
  OrgPolicy,
} from "@workspace/contract/schemas/tenancy";
import { type AsyncResult, ok } from "@workspace/shared/result";
import { z } from "zod";

import type { ProviderCredentials } from "../ports/provider-registry";
import { type KeyStore, type KeyStoreError, sameScope } from "./key-store";

// `resolveChatKeys` (D17): which key pays for a call, from the chat context.
//
// 1. The context's own keys: the team, then its ancestors, then the org.
// 2. The user's personal keys, if the org allows it (off by default).
// 3. Instance keys, if the instance enables them for that context type.
//
// In the personal context: the user's keys, then instance keys if enabled.
// Resolution is per provider: a team's Anthropic key and the org's OpenAI key
// are both usable in a team chat.

/**
 * A `ChatContext` with what resolution needs filled in by the server: who is
 * asking, the org, and the team's ancestry (which the contract's `{ id }`
 * doesn't carry).
 */
export const keyContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("personal"), userId: userIdSchema }),
  z.object({
    orgId: orgIdSchema,
    /** The chat's team first, then its parent, up to the top-level team. */
    teamPath: z.array(teamIdSchema).min(1),
    type: z.literal("team"),
    userId: userIdSchema,
  }),
  z.object({
    orgId: orgIdSchema,
    type: z.literal("org"),
    userId: userIdSchema,
  }),
]);
export type KeyContext = z.infer<typeof keyContextSchema>;

export interface KeyPolicy {
  readonly instance: Pick<
    InstancePolicy,
    "instanceKeys" | "personalKeyFallback"
  >;
  /** The org's effective policy; `null` in the personal context. */
  readonly org: Pick<OrgPolicy, "personalKeyFallback"> | null;
}

/** The key to use for each provider, keyed by provider id. */
export type ChatKeys = Readonly<Record<string, ProviderCredentials>>;

/** Scopes to look in, most preferred first. Pure. */
export const keyScopesFor = (
  context: KeyContext,
  { instance, org }: KeyPolicy
): readonly KeyScope[] => {
  const user: KeyScope = { id: context.userId, type: "user" };
  const instanceScope: readonly KeyScope[] = instance.instanceKeys[context.type]
    ? [{ type: "instance" }]
    : [];
  if (context.type === "personal") {
    return [user, ...instanceScope];
  }
  // Checked against both layers: the org's stored choice may predate an
  // instance that has since forbidden the fallback.
  const personalFallback =
    instance.personalKeyFallback === "allowed" &&
    org?.personalKeyFallback === true;
  const own: readonly KeyScope[] =
    context.type === "team"
      ? [
          ...context.teamPath.map((id): KeyScope => ({ id, type: "team" })),
          { id: context.orgId, type: "org" },
        ]
      : [{ id: context.orgId, type: "org" }];
  return [...own, ...(personalFallback ? [user] : []), ...instanceScope];
};

/**
 * For each provider, the key from the earliest scope that has one. Keys from
 * scopes not in the list are ignored, whatever the store returned. Pure.
 */
export const pickKeys = (
  scopes: readonly KeyScope[],
  keys: readonly ProviderCredentials[]
): ChatKeys => {
  const picked: Record<string, ProviderCredentials> = {};
  for (const scope of scopes) {
    for (const key of keys) {
      if (!picked[key.provider] && sameScope(scope, key.source)) {
        picked[key.provider] = key;
      }
    }
  }
  return picked;
};

export const resolveChatKeys = async (
  context: KeyContext,
  keyStore: KeyStore,
  policy: KeyPolicy,
  options?: { readonly signal?: AbortSignal }
): AsyncResult<ChatKeys, KeyStoreError> => {
  const scopes = keyScopesFor(context, policy);
  const keys = await keyStore.keysFor(scopes, options);
  return keys.ok ? ok(pickKeys(scopes, keys.value)) : keys;
};

/** Providers with a usable key, for `ProviderRegistry.listModels`. */
export const keyedProviders = (keys: ChatKeys): ReadonlySet<string> =>
  new Set(Object.keys(keys));
