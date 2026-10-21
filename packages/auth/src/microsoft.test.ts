import { appConfigSchema } from "@workspace/config/schema";
import { account, user } from "@workspace/db/schema/auth";
import { createTestDb, type TestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  decideMicrosoftAccess,
  decideProfileSync,
  syncMicrosoftPhoto,
} from "./microsoft";
import type { AvatarStore } from "./ports/avatar-store";
import { createMemoryAvatarStore } from "./ports/avatar-store.memory";
import { type Auth, createAuth } from "./server";
import { fastTestHasher, signUp } from "./testing";

// Ticket 186. Microsoft's endpoints are MSW handlers: nothing leaves the
// process. The sign-in tests drive the real Better Auth callback.

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const TENANT = "4f1c9a7e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_TENANT = "0a0a0a0a-1b1b-4c4c-8d8d-2e2e2e2e2e2e";
const APP = "http://localhost:3005";
const SYNCED_AVATAR =
  /^memory:\/\/avatars\/microsoft\/[0-9a-f]{32}\/[0-9a-f]{32}$/;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const warnings: string[] = [];
const ports = (avatars: AvatarStore) => ({
  avatars,
  fetch,
  warn: (message: string) => warnings.push(message),
});

const photoHandlers = ({
  bytes = JPEG,
  etag = 'W/"photo-1"',
  status = 200,
}: {
  bytes?: Uint8Array;
  etag?: string;
  status?: number;
} = {}) => {
  const downloads = { count: 0 };
  server.use(
    http.get(`${GRAPH}/me/photo`, ({ request }) => {
      if (request.headers.get("authorization") !== "Bearer graph-token") {
        return new HttpResponse(null, { status: 401 });
      }
      return status === 200
        ? HttpResponse.json({ "@odata.mediaEtag": etag, height: 96 })
        : new HttpResponse(null, { status });
    }),
    http.get(`${GRAPH}/me/photo/$value`, () => {
      downloads.count += 1;
      return new HttpResponse(bytes, {
        headers: { "content-type": "image/jpeg" },
      });
    })
  );
  return downloads;
};

describe("decideMicrosoftAccess", () => {
  const lists = {
    allowedDomains: ["contoso.com"],
    allowedTenants: [TENANT],
  };

  it("allows anyone when both lists are empty", () => {
    expect(
      decideMicrosoftAccess(
        { allowedDomains: [], allowedTenants: [] },
        { email: "a@anywhere.test", tenantId: undefined }
      ).ok
    ).toBe(true);
  });

  it("needs both the tenant and the domain when both are listed", () => {
    expect(
      decideMicrosoftAccess(lists, {
        email: "Ada@Contoso.com",
        tenantId: TENANT.toUpperCase(),
      }).ok
    ).toBe(true);
    expect(
      decideMicrosoftAccess(lists, {
        email: "ada@contoso.com",
        tenantId: OTHER_TENANT,
      })
    ).toEqual({ error: "microsoft_tenant_not_allowed", ok: false });
    expect(
      decideMicrosoftAccess(lists, {
        email: "ada@fabrikam.com",
        tenantId: TENANT,
      })
    ).toEqual({ error: "microsoft_domain_not_allowed", ok: false });
  });
});

describe("syncMicrosoftPhoto", () => {
  const sync = (avatars: AvatarStore, maxBytes = 1024) =>
    syncMicrosoftPhoto(
      { accessToken: "graph-token", oid: "oid-1" },
      { maxBytes },
      ports(avatars)
    );

  it("stores the photo once and reuses it while the ETag holds", async () => {
    const avatars = createMemoryAvatarStore();
    const downloads = photoHandlers();

    const first = await sync(avatars);
    expect(first.kind).toBe("stored");
    expect([...avatars.avatars.values()]).toEqual([
      { bytes: JPEG, contentType: "image/jpeg" },
    ]);

    const second = await sync(avatars);
    expect(second).toEqual({
      kind: "unchanged",
      url: first.kind === "stored" ? first.url : "",
    });
    expect(downloads.count).toBe(1);
  });

  it("stores a new copy when the photo changes", async () => {
    const avatars = createMemoryAvatarStore();
    photoHandlers({ etag: "v1" });
    await sync(avatars);
    photoHandlers({ etag: "v2" });
    expect((await sync(avatars)).kind).toBe("stored");
    expect(avatars.avatars.size).toBe(2);
  });

  it("reports no photo on Graph's 404", async () => {
    const avatars = createMemoryAvatarStore();
    photoHandlers({ status: 404 });
    expect(await sync(avatars)).toEqual({ kind: "no_photo" });
    expect(avatars.avatars.size).toBe(0);
  });

  it("skips a photo over the size cap", async () => {
    const avatars = createMemoryAvatarStore();
    photoHandlers({ bytes: new Uint8Array(4096) });
    expect(await sync(avatars, 1024)).toEqual({
      kind: "skipped",
      reason: "too_large",
    });
    expect(avatars.avatars.size).toBe(0);
  });

  it("skips what isn't an image", async () => {
    const avatars = createMemoryAvatarStore();
    photoHandlers();
    server.use(
      http.get(`${GRAPH}/me/photo/$value`, () => HttpResponse.text("<html>"))
    );
    expect(await sync(avatars)).toEqual({
      kind: "skipped",
      reason: "not_an_image",
    });
  });
});

describe("decideProfileSync", () => {
  const photo = (url: string) => ({ kind: "photo", url }) as const;
  const synced = {
    image: "avatars/old",
    name: "Ada Lovelace",
    syncedImage: "avatars/old",
    syncedName: "Ada Lovelace",
  };

  it("takes the directory's name and photo for a new user", () => {
    expect(
      decideProfileSync(undefined, {
        name: "Ada Lovelace",
        photo: photo("avatars/new"),
      })
    ).toEqual({
      image: "avatars/new",
      name: "Ada Lovelace",
      syncedImage: "avatars/new",
      syncedName: "Ada Lovelace",
    });
  });

  it("follows the directory while nothing was edited", () => {
    expect(
      decideProfileSync(synced, {
        name: "Ada King",
        photo: photo("avatars/new"),
      })
    ).toEqual({
      image: "avatars/new",
      name: "Ada King",
      syncedImage: "avatars/new",
      syncedName: "Ada King",
    });
  });

  it("keeps what the person edited, and records the directory's value", () => {
    expect(
      decideProfileSync(
        { ...synced, image: "uploads/mine", name: "Countess" },
        { name: "Ada King", photo: photo("avatars/new") }
      )
    ).toEqual({
      image: "uploads/mine",
      name: "Countess",
      syncedImage: "avatars/new",
      syncedName: "Ada King",
    });
  });

  it("removes a synced photo the directory no longer has", () => {
    expect(
      decideProfileSync(synced, {
        name: "Ada Lovelace",
        photo: { kind: "none" },
      })
    ).toMatchObject({ image: null, syncedImage: null });
  });

  it("keeps the person's own photo when the directory has none", () => {
    expect(
      decideProfileSync(
        { ...synced, image: "uploads/mine" },
        { name: "Ada Lovelace", photo: { kind: "none" } }
      )
    ).toMatchObject({ image: "uploads/mine", syncedImage: null });
  });

  it("leaves the photo and its record alone when Graph failed", () => {
    expect(
      decideProfileSync(
        { ...synced, syncedImage: "avatars/older" },
        { name: "Ada Lovelace", photo: { kind: "unknown" } }
      )
    ).toMatchObject({ image: "avatars/old", syncedImage: "avatars/older" });
  });

  it("keeps the name of an account that never synced", () => {
    expect(
      decideProfileSync(
        { image: null, name: "Ada", syncedImage: null, syncedName: null },
        { name: "Ada Lovelace", photo: photo("avatars/new") }
      )
    ).toEqual({
      image: "avatars/new",
      name: "Ada",
      syncedImage: "avatars/new",
      syncedName: "Ada Lovelace",
    });
  });
});

// --- Sign-in through Better Auth's real callback --------------------------

const base64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned ID token; the code exchange is what the callback trusts. */
const idToken = (claims: Record<string, unknown>) =>
  `${base64url({ alg: "RS256", kid: "k1", typ: "JWT" })}.${base64url({
    aud: "client-id",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    iss: `${LOGIN}/${TENANT}/v2.0`,
    name: "Ada Lovelace",
    oid: "oid-ada",
    tid: TENANT,
    ...claims,
  })}.c2ln`;

const tokenEndpoint = (claims: Record<string, unknown> = {}) =>
  server.use(
    http.post(`${LOGIN}/:tenant/oauth2/v2.0/token`, () =>
      HttpResponse.json({
        access_token: "graph-token",
        expires_in: 3600,
        id_token: idToken(claims),
        refresh_token: "refresh-token",
        scope: "openid profile email offline_access User.Read",
        token_type: "Bearer",
      })
    )
  );

let testDb: TestDb | undefined;
afterEach(async () => {
  await testDb?.close();
  testDb = undefined;
  warnings.length = 0;
});

const microsoftAuth = async (
  microsoft: Record<string, unknown>,
  avatars: AvatarStore,
  auth: Record<string, unknown> = {}
): Promise<Auth> => {
  testDb = await createTestDb();
  const created = createAuth({
    avatars,
    config: appConfigSchema.parse({
      auth: {
        ...auth,
        microsoft: { clientId: "client-id", clientSecret: "shh", ...microsoft },
      },
    }),
    db: testDb.db,
    env: {
      BETTER_AUTH_SECRET: "test-secret-0123456789abcdefghijklmnop",
      BETTER_AUTH_URL: APP,
    },
    log: { warn: (message) => warnings.push(message) },
    passwordHasher: fastTestHasher,
  });
  if (!created.ok) {
    throw new Error("createAuth failed");
  }
  return created.value;
};

/** Starts sign-in, then comes back from "Microsoft" with a code. */
const signInWithMicrosoft = async (auth: Auth) => {
  const start = await auth.handler(
    new Request(`${APP}/api/auth/sign-in/social`, {
      body: JSON.stringify({ callbackURL: "/", provider: "microsoft" }),
      headers: { "content-type": "application/json", origin: APP },
      method: "POST",
    })
  );
  const { url } = (await start.json()) as { url: string };
  const cookies = start.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const state = new URL(url).searchParams.get("state") ?? "";
  const back = await auth.handler(
    new Request(
      `${APP}/api/auth/callback/microsoft?code=the-code&state=${state}`,
      { headers: { cookie: cookies } }
    )
  );
  return { authorizeUrl: new URL(url), location: back.headers.get("location") };
};

describe("Sign in with Microsoft", () => {
  it("sends the browser to the configured tenant with Graph's scopes", async () => {
    const auth = await microsoftAuth(
      { tenantId: TENANT },
      createMemoryAvatarStore()
    );
    const start = await auth.handler(
      new Request(`${APP}/api/auth/sign-in/social`, {
        body: JSON.stringify({ callbackURL: "/", provider: "microsoft" }),
        headers: { "content-type": "application/json", origin: APP },
        method: "POST",
      })
    );
    const url = new URL(((await start.json()) as { url: string }).url);
    expect(`${url.origin}${url.pathname}`).toBe(
      `${LOGIN}/${TENANT}/oauth2/v2.0/authorize`
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${APP}/api/auth/callback/microsoft`
    );
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "User.Read",
      "email",
      "offline_access",
      "openid",
      "profile",
    ]);
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("creates the user with their photo and keeps no Microsoft token", async () => {
    const avatars = createMemoryAvatarStore();
    const auth = await microsoftAuth({}, avatars);
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers();

    const { location } = await signInWithMicrosoft(auth);
    expect(location).toBe("/");

    const [row] = await (testDb as TestDb).db.select().from(user);
    expect(row).toMatchObject({
      email: "ada@contoso.com",
      name: "Ada Lovelace",
    });
    expect(row?.image).toMatch(SYNCED_AVATAR);
    const [linked] = await (testDb as TestDb).db.select().from(account);
    expect(linked).toMatchObject({
      accessToken: null,
      idToken: null,
      providerId: "microsoft",
      refreshToken: null,
    });
  });

  it("refreshes the name and photo on a later sign-in", async () => {
    const avatars = createMemoryAvatarStore();
    const auth = await microsoftAuth({}, avatars);
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers({ etag: "v1" });
    await signInWithMicrosoft(auth);
    const [before] = await (testDb as TestDb).db.select().from(user);

    tokenEndpoint({ email: "ada@contoso.com", name: "Ada King" });
    photoHandlers({ etag: "v2" });
    await signInWithMicrosoft(auth);
    const [after] = await (testDb as TestDb).db.select().from(user);
    expect(after?.name).toBe("Ada King");
    expect(after?.image).not.toBe(before?.image);
  });

  it("keeps a name and photo the person changed since the last sign-in", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers({ etag: "v1" });
    await signInWithMicrosoft(auth);
    const { db } = testDb as TestDb;
    await db.update(user).set({ image: null, name: "Countess of Lovelace" });

    tokenEndpoint({ email: "ada@contoso.com", name: "Ada King" });
    photoHandlers({ etag: "v2" });
    await signInWithMicrosoft(auth);
    const [after] = await db.select().from(user);
    expect(after).toMatchObject({
      image: null,
      name: "Countess of Lovelace",
      syncedName: "Ada King",
    });
    expect(after?.syncedImage).toMatch(SYNCED_AVATAR);
  });

  it("removes the synced photo once Microsoft has none", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers();
    await signInWithMicrosoft(auth);

    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers({ status: 404 });
    expect((await signInWithMicrosoft(auth)).location).toBe("/");
    const [after] = await (testDb as TestDb).db.select().from(user);
    expect(after).toMatchObject({ image: null, syncedImage: null });
  });

  it("keeps a photo the person set themselves when Microsoft has none", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers();
    await signInWithMicrosoft(auth);
    const { db } = testDb as TestDb;
    await db.update(user).set({ image: `${APP}/api/storage/mine.png` });

    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers({ status: 404 });
    await signInWithMicrosoft(auth);
    const [after] = await db.select().from(user);
    expect(after?.image).toBe(`${APP}/api/storage/mine.png`);
  });

  it("signs in without a photo when Graph has none", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers({ status: 404 });
    const { location } = await signInWithMicrosoft(auth);
    expect(location).toBe("/");
    const [row] = await (testDb as TestDb).db.select().from(user);
    expect(row?.image).toBeNull();
  });

  it.each([
    [
      "a tenant outside `allowedTenants`",
      { allowedTenants: [OTHER_TENANT] },
      "microsoft_tenant_not_allowed",
    ],
    [
      "a domain outside `allowedDomains`",
      { allowedDomains: ["fabrikam.com"] },
      "microsoft_domain_not_allowed",
    ],
  ])("refuses %s, server-side", async (_label, lists, code) => {
    const auth = await microsoftAuth(lists, createMemoryAvatarStore());
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers();
    const { location } = await signInWithMicrosoft(auth);
    expect(new URL(location ?? "", APP).searchParams.get("error")).toBe(code);
    expect(await (testDb as TestDb).db.select().from(user)).toEqual([]);
  });

  it("auto-provisions allowed users past `signup: invite`", async () => {
    const auth = await microsoftAuth(
      { allowedTenants: [TENANT], autoProvision: true },
      createMemoryAvatarStore()
    );
    tokenEndpoint({ email: "first@contoso.com", oid: "oid-1" });
    photoHandlers();
    await signInWithMicrosoft(auth);
    // The first user always gets in; the second needs auto-provisioning.
    tokenEndpoint({ email: "second@contoso.com", oid: "oid-2" });
    const { location } = await signInWithMicrosoft(auth);
    expect(location).toBe("/");
    expect(await (testDb as TestDb).db.select().from(user)).toHaveLength(2);
  });

  it("follows `signup: invite` without auto-provisioning", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    tokenEndpoint({ email: "first@contoso.com", oid: "oid-1" });
    photoHandlers();
    await signInWithMicrosoft(auth);
    tokenEndpoint({ email: "second@contoso.com", oid: "oid-2" });
    const { location } = await signInWithMicrosoft(auth);
    expect(new URL(location ?? "", APP).searchParams.get("error")).toBe(
      "invite_required"
    );
  });
});

describe("what a Microsoft email proves", () => {
  /** The first user, their org and a pending invitation for `email`. */
  const invite = async (auth: Auth, email: string) => {
    const admin = await signUp(auth, "admin@example.test");
    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers: admin.headers,
    });
    await auth.api.createInvitation({
      body: { email, organizationId: org.id, role: "member" },
      headers: admin.headers,
    });
  };
  const errorOf = (location: string | null) =>
    new URL(location ?? "", APP).searchParams.get("error");

  // Another tenant's admin can give their own user the invitee's address.
  it("doesn't let any tenant claim an invitation with an unverified email", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    await invite(auth, "invitee@contoso.com");
    tokenEndpoint({ email: "invitee@contoso.com", tid: OTHER_TENANT });
    photoHandlers();

    expect(errorOf((await signInWithMicrosoft(auth)).location)).toBe(
      "invite_required"
    );
    expect(
      await (testDb as TestDb).db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.email, "invitee@contoso.com"))
    ).toEqual([]);
  });

  it("accepts an invitation when the token verifies the email", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    await invite(auth, "invitee@contoso.com");
    tokenEndpoint({
      email: "invitee@contoso.com",
      verified_primary_email: ["invitee@contoso.com"],
    });
    photoHandlers();

    expect((await signInWithMicrosoft(auth)).location).toBe("/");
  });

  it("doesn't let a changed directory email take an address here", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore(), {
      signup: "open",
    });
    tokenEndpoint({ email: "ada@contoso.com" });
    photoHandlers();
    await signInWithMicrosoft(auth);
    await signUp(auth, "bob@contoso.com");
    const emails = async () =>
      await (testDb as TestDb).db
        .select({ email: user.email })
        .from(user)
        .orderBy(user.email);

    // Another account's address, then one nobody here has yet.
    for (const email of ["bob@contoso.com", "ceo@contoso.com"]) {
      tokenEndpoint({ email });
      // biome-ignore lint/performance/noAwaitInLoops: each sign-in follows the last.
      expect((await signInWithMicrosoft(auth)).location).toBe("/");
      expect(await emails()).toEqual([
        { email: "ada@contoso.com" },
        { email: "bob@contoso.com" },
      ]);
    }
    await signUp(auth, "ceo@contoso.com");
    expect(await emails()).toHaveLength(3);
  });

  it("counts an email whose domain the tenant verified (xms_edov)", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    await invite(auth, "invitee@contoso.com");
    tokenEndpoint({
      email: "invitee@contoso.com",
      tid: OTHER_TENANT,
      xms_edov: true,
    });
    photoHandlers();

    expect((await signInWithMicrosoft(auth)).location).toBe("/");
  });
});

describe("the synced profile fields", () => {
  const post = (auth: Auth, path: string, body: unknown, headers = {}) =>
    auth.handler(
      new Request(`${APP}/api/auth${path}`, {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin: APP,
          ...headers,
        },
        method: "POST",
      })
    );

  it("can't be written through `/update-user`", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    const ada = await signUp(auth, "ada@contoso.com");

    const response = await post(
      auth,
      "/update-user",
      { name: "Ada", syncedImage: "x", syncedName: "Ada" },
      Object.fromEntries(ada.headers)
    );
    expect(response.status).toBe(400);
    const [row] = await (testDb as TestDb).db.select().from(user);
    expect(row).toMatchObject({
      name: "ada",
      syncedImage: null,
      syncedName: null,
    });
  });

  it("can't be set at sign-up", async () => {
    const auth = await microsoftAuth({}, createMemoryAvatarStore());
    const response = await post(auth, "/sign-up/email", {
      email: "ada@contoso.com",
      name: "Ada",
      password: "correct-horse-battery",
      syncedName: "Ada",
    });
    expect(response.status).toBe(400);
    expect(await (testDb as TestDb).db.select().from(user)).toEqual([]);
  });
});

describe("registration", () => {
  it("leaves Microsoft off without the block", async () => {
    testDb = await createTestDb();
    const created = createAuth({
      config: appConfigSchema.parse({}),
      db: testDb.db,
      env: { BETTER_AUTH_SECRET: "test-secret-0123456789abcdefghijklmnop" },
      log: { warn: () => undefined },
    });
    expect(
      created.ok && created.value.options.socialProviders
    ).not.toHaveProperty("microsoft");
  });
});
