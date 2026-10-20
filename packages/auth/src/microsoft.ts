import { defineRequestState, hasRequestState } from "@better-auth/core/context";
import {
  MICROSOFT_PROVIDER_ID,
  type MicrosoftSsoConfig,
} from "@workspace/config/microsoft";
import { err, ok, type Result } from "@workspace/shared/result";
import { type MicrosoftOptions, microsoft } from "better-auth/social-providers";
import { z } from "zod";

import type { AvatarStore } from "./ports/avatar-store";
import type { ProfileStore, StoredProfile } from "./ports/profile-store";
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

export interface MicrosoftSsoPorts {
  /** Without it, photos are skipped and Microsoft's sign-in still works. */
  readonly avatars?: AvatarStore;
  readonly fetch: typeof fetch;
  readonly profiles: ProfileStore;
  /** Who has this email here, if anyone. */
  readonly userIdByEmail: (email: string) => Promise<string | undefined>;
  readonly warn: (message: string) => void;
}

export const microsoftRefusalSchema = z.enum([
  "microsoft_tenant_not_allowed",
  "microsoft_domain_not_allowed",
  /** The directory's email, which sign-in copies, is another account's here. */
  "microsoft_email_in_use",
]);
export type MicrosoftRefusal = z.infer<typeof microsoftRefusalSchema>;

const REFUSAL_MESSAGES: Record<MicrosoftRefusal, string> = {
  microsoft_domain_not_allowed:
    "This Microsoft account's email domain can't sign in here.",
  microsoft_email_in_use:
    "This Microsoft account's email belongs to another account here. Ask an admin to sort it out.",
  microsoft_tenant_not_allowed:
    "This Microsoft account's organization can't sign in here.",
};

const refusalOf = (error: MicrosoftRefusal) => ({
  error,
  errorDescription: REFUSAL_MESSAGES[error],
});

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
  {
    avatars,
    fetch: fetchFn,
    warn,
  }: Required<Pick<MicrosoftSsoPorts, "avatars" | "fetch" | "warn">>
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

/** What the directory said about the photo this sign-in. */
export type DirectoryPhoto =
  | { readonly kind: "photo"; readonly url: string }
  | { readonly kind: "none" }
  /** Graph failed, or photos are off: leave the image and its record alone. */
  | { readonly kind: "unknown" };

const directoryPhotoOf = (synced: PhotoSync): DirectoryPhoto => {
  switch (synced.kind) {
    case "stored":
    case "unchanged":
      return { kind: "photo", url: synced.url };
    case "no_photo":
      return { kind: "none" };
    case "skipped":
      return { kind: "unknown" };
    default:
      return synced satisfies never;
  }
};

/**
 * The user's name and image after a Microsoft sign-in, and the values to
 * record as synced. A field follows the directory only while it still
 * equals what the last sign-in copied, so a person's own edit sticks. The
 * record always takes the directory's latest value.
 */
export const decideProfileSync = (
  stored: StoredProfile | undefined,
  directory: { readonly name: string; readonly photo: DirectoryPhoto }
): StoredProfile => {
  const current = stored ?? {
    image: null,
    name: directory.name,
    syncedImage: null,
    syncedName: directory.name,
  };
  const name =
    current.name === current.syncedName ? directory.name : current.name;
  if (directory.photo.kind === "unknown") {
    return {
      image: current.image,
      name,
      syncedImage: current.syncedImage,
      syncedName: directory.name,
    };
  }
  const photo = directory.photo.kind === "photo" ? directory.photo.url : null;
  return {
    image: current.image === current.syncedImage ? photo : current.image,
    name,
    syncedImage: photo,
    syncedName: directory.name,
  };
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

type Synced = Pick<StoredProfile, "syncedImage" | "syncedName">;

export interface MicrosoftSso {
  /** For Better Auth's `account` create and update `before` hooks. */
  readonly accountData: typeof withoutTokens;
  /** `socialProviders.microsoft`. */
  readonly provider: MicrosoftOptions;
  /**
   * For `user.validateUserInfo`: refuses Microsoft accounts outside the
   * allow-lists on sign-up, sign-in and linking, and a sign-in whose
   * directory email another account has; ignores other providers.
   */
  readonly refusal: (data: {
    readonly action: string;
    readonly email: string;
    readonly profile: Record<string, unknown> | undefined;
    readonly providerId: string | undefined;
    readonly userId: string | undefined;
  }) => Promise<
    { error: MicrosoftRefusal; errorDescription: string } | undefined
  >;
  /**
   * For Better Auth's `user` create and update `before` hooks: adds what
   * this request's Microsoft sign-in synced. People can't set these fields
   * themselves (`input: false`), so this is their only writer.
   */
  readonly userData: <T extends object>(user: T) => Promise<T>;
}

/**
 * Better Auth's Microsoft provider for `auth.microsoft`. Email follows the
 * directory on each sign-in; name and photo follow it until the person edits
 * them (`decideProfileSync`). Photos need `photo.enabled` and `avatars`.
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
  const syncedThisRequest = defineRequestState<Synced | null>(() => null);
  const { avatars } = ports;
  const photos = config.photo.enabled && avatars ? { ...ports, avatars } : null;
  const directoryPhoto = async (
    accessToken: string | undefined,
    oid: string
  ): Promise<DirectoryPhoto> => {
    if (!(photos && accessToken)) {
      return { kind: "unknown" };
    }
    const synced = await syncMicrosoftPhoto(
      { accessToken, oid },
      config.photo,
      photos
    ).catch((cause: unknown): PhotoSync => {
      ports.warn(`[auth] Microsoft photo: ${String(cause)}`);
      return { kind: "skipped", reason: "graph_error" };
    });
    return directoryPhotoOf(synced);
  };
  return {
    accountData: withoutTokens,
    provider: {
      ...base,
      disableSignUp: false,
      getUserInfo: async (token) => {
        const info = await decode(token);
        if (!info) {
          return info;
        }
        const oid = claimsSchema.parse(info.data).oid ?? "";
        const photo = await directoryPhoto(token.accessToken, oid);
        const stored = await ports.profiles.find({
          accountId: oid,
          email: info.user.email ?? "",
          providerId: MICROSOFT_PROVIDER_ID,
        });
        const { image, name, syncedImage, syncedName } = decideProfileSync(
          stored,
          { name: info.user.name ?? "", photo }
        );
        await syncedThisRequest.set({ syncedImage, syncedName });
        // Better Auth writes these on sign-up and, through
        // `overrideUserInfoOnSignIn`, on every later sign-in.
        return {
          ...info,
          user: {
            ...info.user,
            // Typed `string | undefined`, but `null` reaches the row, and
            // `undefined` would keep a photo we mean to remove.
            image: image as string | undefined,
            name,
          },
        };
      },
      overrideUserInfoOnSignIn: true,
    },
    refusal: async ({ action, email, profile, providerId, userId }) => {
      if (providerId !== MICROSOFT_PROVIDER_ID) {
        return;
      }
      const decision = decideMicrosoftAccess(config, {
        email,
        tenantId: claimsSchema.safeParse(profile ?? {}).data?.tid,
      });
      if (!decision.ok) {
        return refusalOf(decision.error);
      }
      // Sign-in copies the directory's email over this user's, which can't
      // take an address another account already has.
      if (action === "sign-in") {
        const owner = await ports.userIdByEmail(email);
        if (owner !== undefined && owner !== userId) {
          return refusalOf("microsoft_email_in_use");
        }
      }
    },
    userData: async (user) => {
      const synced = (await hasRequestState())
        ? await syncedThisRequest.get()
        : null;
      return synced ? { ...user, ...synced } : user;
    },
  };
};
