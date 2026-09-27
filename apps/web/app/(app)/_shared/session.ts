import { orgRoleOf } from "@workspace/auth/resources";
import { type Auth, createAuth } from "@workspace/auth/server";
import { loadConfig } from "@workspace/config/load";
import {
  type OrgId,
  type UserId,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import type { OrgRole } from "@workspace/contract/schemas/tenancy";
import { connectFromEnv, type Db } from "@workspace/db/client";
import { headers } from "next/headers";
import { cache } from "react";

// Server-side session checks for settings and admin (024). Until the shell
// (025) boots one server for the whole app, these pages build the auth
// server themselves, once per process. Without a database or, in production,
// without BETTER_AUTH_SECRET, there is no sign-in at all: the pages say so
// instead of crashing (the app boots with an empty `.env`).

export type Unavailable = "no_database" | "no_secret" | "bad_config";

export type Viewer =
  | { readonly kind: "unavailable"; readonly reason: Unavailable }
  | { readonly kind: "signed_out" }
  | { readonly kind: "signed_in"; readonly userId: UserId };

type Boot =
  | { readonly ok: false; readonly reason: Unavailable }
  | { readonly auth: Auth; readonly db: Db; readonly ok: true };

const start = async (): Promise<Boot> => {
  const loaded = await loadConfig();
  if (!loaded.ok) {
    return { ok: false, reason: "bad_config" };
  }
  const connection = connectFromEnv(process.env, { max: 2 });
  if (!connection.ok) {
    return { ok: false, reason: "no_database" };
  }
  const auth = createAuth({
    config: loaded.value.config,
    db: connection.value.db,
  });
  return auth.ok
    ? { auth: auth.value, db: connection.value.db, ok: true }
    : { ok: false, reason: "no_secret" };
};

// One boot per server process: the pool and the auth server are long-lived.
let booting: Promise<Boot> | undefined;
const boot = (): Promise<Boot> => {
  booting ??= start();
  return booting;
};

/** Who is asking, once per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const booted = await boot();
  if (!booted.ok) {
    return { kind: "unavailable", reason: booted.reason };
  }
  try {
    const session = await booted.auth.api.getSession({
      headers: await headers(),
    });
    const userId = userIdSchema.safeParse(session?.user.id);
    return userId.success
      ? { kind: "signed_in", userId: userId.data }
      : { kind: "signed_out" };
  } catch {
    // Postgres unreachable: the same as having no database, for this request.
    return { kind: "unavailable", reason: "no_database" };
  }
});

/** The viewer's role in an org, or `null` when they aren't in it (or it can't be read). */
export const getOrgRole = cache(
  async (orgId: OrgId, userId: UserId): Promise<OrgRole | null> => {
    const booted = await boot();
    if (!booted.ok) {
      return null;
    }
    try {
      return await orgRoleOf(booted.db, orgId, userId);
    } catch {
      return null;
    }
  }
);
