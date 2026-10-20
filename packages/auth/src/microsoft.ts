import {
  MICROSOFT_PROVIDER_ID,
  type MicrosoftSsoConfig,
} from "@workspace/config/microsoft";
import { err, ok, type Result } from "@workspace/shared/result";
import { type MicrosoftOptions, microsoft } from "better-auth/social-providers";
import { z } from "zod";

import { emailDomain } from "./signup";

// Sign in with Microsoft (Entra ID, ticket 186). One call turns
// `auth.microsoft` into everything Better Auth needs: its built-in
// `microsoft` provider, a gate that enforces the tenant and domain
// allow-lists on every sign-in, and the profile photo copied from Microsoft
// Graph into our storage. Graph's access token is used once, in memory, and
// never stored (`withoutTokens`).

const GRAPH = "https://graph.microsoft.com/v1.0";
const PHOTO_TYPES: ReadonlySet<string> = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Where avatars live: the shell backs it with the Storage port and serves
 * `url(key)` itself. Keys are ours and change whenever the photo does.
 */
export interface AvatarStore {
  /** The URL of a stored avatar, or `undefined` when there isn't one. */
  readonly find: (key: string) => Promise<string | undefined>;
  /** Stores the bytes and returns their URL. */
  readonly put: (
    key: string,
    bytes: Uint8Array,
    contentType: string
  ) => Promise<Result<string, string>>;
}

export interface MicrosoftSsoPorts {
  /** Without it, photos are skipped and Microsoft's sign-in still works. */
  readonly avatars?: AvatarStore;
  readonly fetch: typeof fetch;
  readonly warn: (message: string) => void;
}

export const microsoftRefusalSchema = z.enum([
  "microsoft_tenant_not_allowed",
  "microsoft_domain_not_allowed",
]);
export type MicrosoftRefusal = z.infer<typeof microsoftRefusalSchema>;

const REFUSAL_MESSAGES: Record<MicrosoftRefusal, string> = {
  microsoft_domain_not_allowed:
    "This Microsoft account's email domain can't sign in here.",
  microsoft_tenant_not_allowed:
    "This Microsoft account's organization can't sign in here.",
};

const claimsSchema = z.looseObject({
  oid: z.string().optional(),
  tid: z.string().optional(),
});

/** The allow-lists, against the ID token's `tid` and the account's email. */
export const decideMicrosoftAccess = (
  config: Pick<MicrosoftSsoConfig, "allowedDomains" | "allowedTenants">,
  who: { readonly email: string; readonly tenantId: string | undefined }
): Result<void, MicrosoftRefusal> => {
  if (
    config.allowedTenants.length > 0 &&
    !config.allowedTenants.includes(who.tenantId?.toLowerCase() ?? "")
  ) {
    return err("microsoft_tenant_not_allowed");
  }
  if (
    config.allowedDomains.length > 0 &&
    !config.allowedDomains.includes(emailDomain(who.email))
  ) {
    return err("microsoft_domain_not_allowed");
  }
  return ok(undefined);
};

const sha256 = async (input: string | Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .slice(0, 32);
};

const photoMetaSchema = z.looseObject({
  "@odata.mediaEtag": z.string().optional(),
});

/** Reads at most `limit` bytes; `undefined` past it. */
/** Drops a body we won't read; never waits on it (some streams don't settle). */
const discard = (response: Response): void => {
  response.body?.cancel().catch(() => undefined);
};

const readCapped = async (
  response: Response,
  limit: number
): Promise<Uint8Array | undefined> => {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    discard(response);
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: a stream is read one chunk after another.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => undefined);
      return;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * What one sign-in did about the photo. Only `stored` and `unchanged` change
 * the user's image; the rest leave it (a photo never blocks sign-in).
 */
export type PhotoSync =
  | { readonly kind: "stored"; readonly url: string }
  | { readonly kind: "unchanged"; readonly url: string }
  | { readonly kind: "no_photo" }
  | {
      readonly kind: "skipped";
      readonly reason: "graph_error" | "not_an_image" | "too_large" | "storage";
    };

/**
 * Copies the Graph profile photo into `avatars`. The cheap check: Graph's
 * photo metadata carries an ETag, and a key already stored for it skips the
 * download.
 */
export const syncMicrosoftPhoto = async (
  { accessToken, oid }: { readonly accessToken: string; readonly oid: string },
  { maxBytes }: { readonly maxBytes: number },
  { avatars, fetch: fetchFn, warn }: Required<MicrosoftSsoPorts>
): Promise<PhotoSync> => {
  const headers = { authorization: `Bearer ${accessToken}` };
  const meta = await fetchFn(`${GRAPH}/me/photo`, { headers });
  if (meta.status === 404) {
    return { kind: "no_photo" };
  }
  if (!meta.ok) {
    warn(
      `[auth] Microsoft photo: Graph answered ${meta.status}; keeping the current one.`
    );
    return { kind: "skipped", reason: "graph_error" };
  }
  const etag = photoMetaSchema.safeParse(await meta.json().catch(() => null))
    .data?.["@odata.mediaEtag"];
  const folder = `microsoft/${await sha256(oid)}`;
  if (etag) {
    const known = await avatars.find(`${folder}/${await sha256(etag)}`);
    if (known) {
      return { kind: "unchanged", url: known };
    }
  }
  const photo = await fetchFn(`${GRAPH}/me/photo/$value`, { headers });
  if (photo.status === 404) {
    discard(photo);
    return { kind: "no_photo" };
  }
  const contentType = (photo.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (!(photo.ok && contentType && PHOTO_TYPES.has(contentType))) {
    discard(photo);
    warn(
      `[auth] Microsoft photo: not an image (${photo.status}); keeping the current one.`
    );
    return { kind: "skipped", reason: "not_an_image" };
  }
  const bytes = await readCapped(photo, maxBytes);
  if (!bytes) {
    warn(`[auth] Microsoft photo: larger than ${maxBytes} bytes; skipped.`);
    return { kind: "skipped", reason: "too_large" };
  }
  const version = await sha256(etag ?? bytes);
  const stored = await avatars.put(`${folder}/${version}`, bytes, contentType);
  if (!stored.ok) {
    warn(`[auth] Microsoft photo: couldn't store it (${stored.error}).`);
    return { kind: "skipped", reason: "storage" };
  }
  return { kind: "stored", url: stored.value };
};

/** An account row Better Auth is about to write, minus any token. */
const withoutTokens = <T extends { readonly providerId?: string }>(
  account: T
): T =>
  account.providerId === MICROSOFT_PROVIDER_ID
    ? {
        ...account,
        accessToken: null,
        idToken: null,
        refreshToken: null,
      }
    : account;

export interface MicrosoftSso {
  /** For Better Auth's `account` create and update `before` hooks. */
  readonly accountData: typeof withoutTokens;
  /** `socialProviders.microsoft`. */
  readonly provider: MicrosoftOptions;
  /**
   * For `user.validateUserInfo`: refuses Microsoft accounts outside the
   * allow-lists on sign-up, sign-in and linking; ignores other providers.
   */
  readonly refusal: (data: {
    readonly email: string;
    readonly providerId: string | undefined;
    readonly profile: Record<string, unknown> | undefined;
  }) => { error: MicrosoftRefusal; errorDescription: string } | undefined;
}

/**
 * Better Auth's Microsoft provider for `auth.microsoft`. Name and email
 * follow the directory on each sign-in (`overrideUserInfoOnSignIn`), and so
 * does the photo when `photo.enabled` and the shell gave us `avatars`.
 */
export const microsoftSso = (
  config: MicrosoftSsoConfig,
  ports: MicrosoftSsoPorts
): MicrosoftSso => {
  const base: MicrosoftOptions = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    // Ours replaces Better Auth's, which inlines a data: URL into the user row.
    disableProfilePhoto: true,
    // `select_account`, so a shared machine doesn't sign in whoever was last.
    prompt: "select_account",
    tenantId: config.tenantId,
  };
  const decode = microsoft(base).getUserInfo;
  const { avatars } = ports;
  const photos = config.photo.enabled && avatars ? { ...ports, avatars } : null;
  return {
    accountData: withoutTokens,
    provider: {
      ...base,
      disableSignUp: false,
      getUserInfo: async (token) => {
        const info = await decode(token);
        if (!(info && photos && token.accessToken)) {
          return info;
        }
        const oid = claimsSchema.parse(info.data).oid ?? "";
        const synced = await syncMicrosoftPhoto(
          { accessToken: token.accessToken, oid },
          config.photo,
          photos
        ).catch((cause: unknown): PhotoSync => {
          ports.warn(`[auth] Microsoft photo: ${String(cause)}`);
          return { kind: "skipped", reason: "graph_error" };
        });
        return synced.kind === "stored" || synced.kind === "unchanged"
          ? { ...info, user: { ...info.user, image: synced.url } }
          : info;
      },
      overrideUserInfoOnSignIn: true,
    },
    refusal: ({ email, profile, providerId }) => {
      if (providerId !== MICROSOFT_PROVIDER_ID) {
        return;
      }
      const decision = decideMicrosoftAccess(config, {
        email,
        tenantId: claimsSchema.safeParse(profile ?? {}).data?.tid,
      });
      return decision.ok
        ? undefined
        : {
            error: decision.error,
            errorDescription: REFUSAL_MESSAGES[decision.error],
          };
    },
  };
};
