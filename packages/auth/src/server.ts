import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { AppConfig } from "@workspace/config/schema";
import type {
  InvitationId,
  OrgId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  account,
  invitation,
  member,
  organization,
  session,
  user,
  verification,
} from "@workspace/db/schema/auth";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import {
  admin,
  bearer,
  type GenericOAuthConfig,
  genericOAuth,
  organization as organizationPlugin,
} from "better-auth/plugins";

import {
  type AuthEnv,
  authEnvSchema,
  resolveSecret,
  type SecretProblem,
} from "./env";
import { decideSignUp, type SignUpRefusal } from "./signup";
import {
  bootstrapUser,
  hasPendingInvitation,
  isFirstUser,
  isPersonalOrg,
  joinInvitedTeams,
  leaveOrgTeams,
} from "./store";

// The Better Auth server (D22): email and password, GitHub and Google when
// their credentials exist, generic OIDC from app.config.yaml, and the
// organization, admin and bearer plugins, over our Drizzle schema with
// UUIDv7 ids (ticket 008). Built per call with its ports as arguments; the
// shell (025) builds one at boot and mounts `auth.handler` at /api/auth.

/** Where warnings go. The dev-secret warning must reach whoever runs the server. */
export interface AuthLog {
  readonly warn: (message: string) => void;
}

export interface CreateAuthOptions {
  readonly config: AppConfig;
  readonly db: Db;
  /** Defaults to `process.env`; parsed, so unknown keys and blanks are fine. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: AuthLog;
  /**
   * Overrides Better Auth's password hashing. Only tests pass this: the
   * default scrypt is deliberately slow, which times out suites on CI runners.
   */
  readonly passwordHasher?: PasswordHasher;
}

export interface PasswordHasher {
  readonly hash: (password: string) => Promise<string>;
  readonly verify: (data: {
    hash: string;
    password: string;
  }) => Promise<boolean>;
}

const consoleLog: AuthLog = {
  warn: (message) => console.warn(message),
};

const REFUSAL_MESSAGES: Record<SignUpRefusal, string> = {
  domain_not_allowed:
    "Sign-up is limited to certain email domains. Ask an admin for an invitation.",
  invite_required: "Sign-up is by invitation. Ask an admin to invite you.",
  sso_required: "Sign in with your organization's single sign-on.",
};

interface SocialCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * GitHub/Google credentials from app.config.yaml `auth.social`, else from the
 * environment. Half a pair is as good as none: the provider stays off.
 */
const socialCredentials = (
  config: AppConfig,
  env: AuthEnv,
  provider: "github" | "google"
): SocialCredentials | undefined => {
  const fromConfig = config.auth.social[provider];
  if (fromConfig) {
    return fromConfig;
  }
  const clientId =
    provider === "github" ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret =
    provider === "github" ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
};

const TRAILING_SLASHES = /\/+$/;

const oidcProviders = (config: AppConfig): GenericOAuthConfig[] =>
  config.auth.oidc.map((provider) => ({
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    discoveryUrl: `${provider.issuer.replace(TRAILING_SLASHES, "")}/.well-known/openid-configuration`,
    name: provider.name,
    pkce: true,
    providerId: provider.id,
    // Identity comes from ID-token claims, so never fall back to decoding
    // an unverified token when discovery is down.
    requireIdTokenVerification: true,
    scopes: provider.scopes,
  }));

const personalOrgRefusal = (action: string): APIError =>
  new APIError("FORBIDDEN", {
    code: "PERSONAL_ORG",
    message: `A personal space can't ${action}.`,
  });

const buildAuth = (
  db: Db,
  config: AppConfig,
  env: AuthEnv,
  secret: string,
  passwordHasher?: PasswordHasher
) => {
  const github = socialCredentials(config, env, "github");
  const google = socialCredentials(config, env, "google");
  return betterAuth({
    advanced: {
      database: {
        // UUIDv7 everywhere, Better Auth's rows included (ticket 008).
        generateId: ({ model }) => newId(model),
      },
    },
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        account,
        invitation,
        member,
        organization,
        session,
        user,
        verification,
      },
    }),
    databaseHooks: {
      user: {
        create: {
          // Runs after Better Auth's transaction commits (queued), so the
          // user row is visible to our own connection.
          after: async (created) => {
            await bootstrapUser(db, {
              id: created.id as UserId,
              name: created.name,
            });
          },
        },
      },
    },
    emailAndPassword: passwordHasher
      ? { enabled: true, password: passwordHasher }
      : { enabled: true },
    plugins: [
      organizationPlugin({
        allowUserToCreateOrganization: true,
        organizationHooks: {
          afterAcceptInvitation: async ({
            invitation: accepted,
            user: who,
          }) => {
            await joinInvitedTeams(
              db,
              accepted.id as InvitationId,
              who.id as UserId
            );
          },
          afterRemoveMember: async ({ member: removed }) => {
            await leaveOrgTeams(
              db,
              removed.organizationId as OrgId,
              removed.userId as UserId
            );
          },
          beforeAddMember: async ({ organization: org }) => {
            if (await isPersonalOrg(db, org.id)) {
              throw personalOrgRefusal("have other members");
            }
          },
          beforeCreateInvitation: async ({ organization: org }) => {
            if (await isPersonalOrg(db, org.id)) {
              throw personalOrgRefusal("have other members");
            }
          },
          beforeDeleteOrganization: async ({ organization: org }) => {
            if (await isPersonalOrg(db, org.id)) {
              throw personalOrgRefusal("be deleted");
            }
          },
        },
        // Invitation ids are UUIDv7 (not opaque), so Better Auth would ask for
        // a verified email before accepting one. There is no mail transport
        // in M1, so nobody could accept anything; the recipient check (the
        // session's email must match the invitation's) still applies.
        requireEmailVerificationOnInvitation: false,
        schema: {
          organization: {
            additionalFields: {
              // Set only by `bootstrapUser`; never from a request.
              isPersonal: {
                defaultValue: false,
                input: false,
                required: false,
                type: "boolean",
              },
            },
          },
        },
      }),
      admin(),
      bearer(),
      genericOAuth({ config: oidcProviders(config) }),
    ],
    secret,
    socialProviders: {
      ...(github ? { github } : {}),
      ...(google ? { google } : {}),
    },
    telemetry: { enabled: false },
    trustedOrigins: env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : undefined,
    user: {
      validateUserInfo: async ({ source, user: incoming }) => {
        if (source.action !== "create-user") {
          return;
        }
        const email = typeof incoming.email === "string" ? incoming.email : "";
        const [first, invited] = await Promise.all([
          isFirstUser(db),
          hasPendingInvitation(db, email),
        ]);
        const decision = decideSignUp(
          config.auth,
          {
            email,
            method: source.method,
            providerId: source.oauth?.providerId ?? source.sso?.providerId,
          },
          { hasPendingInvitation: invited, isFirstUser: first }
        );
        return decision.ok
          ? undefined
          : {
              error: decision.error,
              errorDescription: REFUSAL_MESSAGES[decision.error],
            };
      },
    },
  });
};

export type Auth = ReturnType<typeof buildAuth>;
export type AuthSession = Auth["$Infer"]["Session"];

/**
 * The auth server for this instance. `missing_secret` only in production
 * without `BETTER_AUTH_SECRET`: the shell then serves without sign-in and
 * says why, rather than signing sessions with a key anyone can read.
 * Outside production a fixed dev secret stands in, with a loud warning.
 */
export const createAuth = ({
  config,
  db,
  env = process.env,
  log = consoleLog,
  passwordHasher,
}: CreateAuthOptions): Result<Auth, SecretProblem> => {
  const parsed = authEnvSchema.parse(env);
  const secret = resolveSecret(parsed);
  switch (secret.kind) {
    case "missing":
      return err(secret.problem);
    case "dev_fallback":
      log.warn(
        "[auth] BETTER_AUTH_SECRET is not set: using a fixed dev-only secret. Sessions are forgeable; set it before deploying (openssl rand -base64 32)."
      );
      return ok(buildAuth(db, config, parsed, secret.secret, passwordHasher));
    case "configured":
      return ok(buildAuth(db, config, parsed, secret.secret, passwordHasher));
    default: {
      const exhaustive: never = secret;
      return exhaustive;
    }
  }
};
