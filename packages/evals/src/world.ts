import { randomBytes } from "node:crypto";

import { type ApiClient, createApiClient } from "@workspace/client/api";
import type { OrgId, UserId } from "@workspace/contract/schemas/common";

// Who the evals act as, made over HTTP on a server that starts empty:
//
//   ada  the first sign-up, so the instance admin; owner of both orgs
//   ben  a member of Acme
//   dee  a member of Globex, and of nothing ben is in
//
// The server is invite-only after the first account, so ben and dee join by
// invitation, each into a different org: ben and dee share no org, team or
// chat, which is what the tenant-isolation cases need.

export const USER_NAMES = ["ada", "ben", "dee"] as const;
export type UserName = (typeof USER_NAMES)[number];

export interface Session {
  /** The typed API client the app uses, carrying this user's session cookie. */
  readonly api: ApiClient;
  readonly email: string;
  /** A request as this user, for routes that aren't procedures (the run stream, file content). */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Headers that make a request this user's. */
  readonly headers: () => Record<string, string>;
  readonly id: UserId;
  readonly name: UserName;
}

export interface World {
  readonly baseUrl: string;
  readonly orgs: { readonly acme: OrgId; readonly globex: OrgId };
  readonly users: Readonly<Record<UserName, Session>>;
}

const PEOPLE: Record<
  UserName,
  { readonly display: string; readonly ip: string }
> = {
  // Sign-up is rate limited per client address. The server trusts
  // loopback as its proxy (serve.ts), so each account signs up from its
  // own documentation address (RFC 5737), as three people would.
  ada: { display: "Ada Admin", ip: "203.0.113.11" },
  ben: { display: "Ben Builder", ip: "203.0.113.12" },
  dee: { display: "Dee Outsider", ip: "203.0.113.13" },
};

const emailOf = (name: UserName) => `${name}@evals.test`;

/** `name=value; …` from a response's `Set-Cookie` headers. */
export const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");

const signUp = async (
  baseUrl: string,
  name: UserName,
  password: string
): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    body: JSON.stringify({
      email: emailOf(name),
      name: PEOPLE[name].display,
      password,
    }),
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      "x-forwarded-for": PEOPLE[name].ip,
    },
    method: "POST",
  });
  const cookie = cookieFrom(response);
  if (!(response.ok && cookie)) {
    throw new Error(
      `couldn't sign ${name} up: ${response.status} ${(await response.text()).slice(0, 300)}`
    );
  }
  return cookie;
};

const sessionFor = async (
  baseUrl: string,
  name: UserName,
  cookie: string
): Promise<Session> => {
  const headers = () => ({ cookie, origin: baseUrl });
  const api = createApiClient({
    baseUrl,
    batch: false,
    fetch: globalThis.fetch,
    headers,
  });
  const me = await api.me.get();
  return {
    api,
    email: emailOf(name),
    fetch: (path, init) =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers(), ...init?.headers },
      }),
    headers,
    id: me.user.id,
    name,
  };
};

export const createWorld = async (baseUrl: string): Promise<World> => {
  // Throwaway: made for this run's server, which is deleted with its
  // database when the run ends. Never written anywhere.
  const password = randomBytes(24).toString("base64url");

  const ada = await sessionFor(
    baseUrl,
    "ada",
    await signUp(baseUrl, "ada", password)
  );
  const acme = await ada.api.orgs.create({ name: "Acme", slug: "acme" });
  const globex = await ada.api.orgs.create({ name: "Globex", slug: "globex" });

  const join = async (name: UserName, orgId: OrgId): Promise<Session> => {
    const invitation = await ada.api.orgs.invite({
      email: emailOf(name),
      orgId,
    });
    const session = await sessionFor(
      baseUrl,
      name,
      await signUp(baseUrl, name, password)
    );
    if (!invitation.token) {
      throw new Error(`the invitation for ${name} came without its token`);
    }
    await session.api.orgs.acceptInvitation({ token: invitation.token });
    return session;
  };

  const ben = await join("ben", acme.id);
  const dee = await join("dee", globex.id);
  return {
    baseUrl,
    orgs: { acme: acme.id, globex: globex.id },
    users: { ada, ben, dee },
  };
};
